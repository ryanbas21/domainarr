import { Duration, Effect, Layer, Option, Redacted, Schedule, Schema } from "effect"
import Cloudflare from "cloudflare"
import { DnsRecord, Domain, parseProviderDnsRecord } from "../../domain/DnsRecord.js"
import {
  DnsProvider,
  DnsProviderError,
  DnsProviderAuthError,
  ProviderDnsRecord,
  type DnsProviderErrors
} from "../DnsProvider.js"

// Cloudflare-specific configuration schema
export const CloudflareConfig = Schema.Struct({
  type: Schema.Literal("cloudflare"),
  apiToken: Schema.Redacted(Schema.String),
  zoneId: Schema.String,
  zone: Schema.String
})
export type CloudflareConfig = typeof CloudflareConfig.Type

const PROVIDER_NAME = "cloudflare"
const HTTP_TIMEOUT = Duration.seconds(30)

// Retry configuration for transient errors
// Note: baseDelay is 1s (not 500ms) to provide natural backoff for Cloudflare 429s,
// since the SDK doesn't expose Retry-After headers.
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: Duration.seconds(1)
}

// Exponential backoff with jitter, capped at maxAttempts retries
const retrySchedule = Schedule.intersect(
  Schedule.exponential(RETRY_CONFIG.baseDelay).pipe(Schedule.jittered),
  Schedule.recurs(RETRY_CONFIG.maxAttempts - 1)
)

// Determine if an error is retryable (transient)
const isRetryable = (error: DnsProviderErrors): boolean =>
  error._tag === "DnsProviderError" &&
  error.code !== undefined &&
  (error.code >= 500 || error.code === 429) // 5xx or rate limited


// Wrap Cloudflare SDK errors into domain errors
const wrapError = (e: unknown): DnsProviderErrors => {
  if (e instanceof Cloudflare.AuthenticationError) {
    return new DnsProviderAuthError({
      provider: PROVIDER_NAME,
      message: e.message
    })
  }
  if (e instanceof Cloudflare.APIError) {
    return new DnsProviderError({
      provider: PROVIDER_NAME,
      message: e.message,
      code: e.status
    })
  }
  return new DnsProviderError({
    provider: PROVIDER_NAME,
    message: e instanceof Error ? e.message : String(e)
  })
}

// Helper to wrap SDK calls with timeout
const withTimeout = <A>(effect: Effect.Effect<A, DnsProviderErrors>): Effect.Effect<A, DnsProviderErrors> =>
  effect.pipe(
    Effect.timeout(HTTP_TIMEOUT),
    Effect.catchTag("TimeoutException", () =>
      Effect.fail(new DnsProviderError({
        provider: PROVIDER_NAME,
        message: `Request timed out after ${Duration.toSeconds(HTTP_TIMEOUT)}s`
      }))
    )
  )

// Helper to wrap SDK calls with retry for transient errors
const withRetry = <A>(effect: Effect.Effect<A, DnsProviderErrors>): Effect.Effect<A, DnsProviderErrors> =>
  effect.pipe(
    Effect.retry({
      schedule: retrySchedule,
      while: isRetryable
    })
  )

// List all A records in the zone
const list = Effect.fn("CloudflareProvider.list")(
  function* (client: Cloudflare, zoneId: string) {
    const rawRecords = yield* withTimeout(withRetry(Effect.tryPromise({
      try: async () => {
        const result: Array<{ name: string; content: string; id: string }> = []
        for await (const record of client.dns.records.list({
          zone_id: zoneId,
          type: "A"
        })) {
          if (record.type === "A" && record.content) {
            result.push({ name: record.name, content: record.content, id: record.id })
          }
        }
        return result
      },
      catch: wrapError
    })))

    // Parse and validate each record, logging any that fail
    const records = yield* Effect.forEach(
      rawRecords,
      (raw) => parseProviderDnsRecord(raw.name, raw.content, raw.id).pipe(
        Effect.catchAll((e) =>
          Effect.logWarning(`Skipping invalid record "${raw.name}": ${e.message}`).pipe(
            Effect.annotateLogs({ service: "cloudflare" }),
            Effect.as(null)
          )
        )
      ),
      { concurrency: 1 }
    )

    return records.filter((r): r is ProviderDnsRecord => r !== null)
  }
)

// Find a specific record by domain
const find = (client: Cloudflare, zoneId: string) => (domain: Domain) =>
  withTimeout(withRetry(Effect.tryPromise({
    try: async () => {
      const result: Array<{ name: string; content: string; id: string }> = []
      for await (const record of client.dns.records.list({
        zone_id: zoneId,
        type: "A",
        name: { exact: domain as string }
      })) {
        if (record.type === "A" && record.content) {
          result.push({ name: record.name, content: record.content, id: record.id })
        }
      }
      return result
    },
    catch: wrapError
  }))).pipe(
    Effect.flatMap((rawRecords) => {
      if (rawRecords.length === 0) return Effect.succeed(Option.none<ProviderDnsRecord>())
      const raw = rawRecords[0]
      return parseProviderDnsRecord(raw.name, raw.content, raw.id).pipe(
        Effect.map(Option.some),
        Effect.catchAll((e) =>
          Effect.logWarning(`Invalid record format for "${raw.name}": ${e.message}`).pipe(
            Effect.annotateLogs({ service: "cloudflare" }),
            Effect.as(Option.none<ProviderDnsRecord>())
          )
        )
      )
    }),
    Effect.withSpan("CloudflareProvider.find")
  )

// Add a new A record
const add = (client: Cloudflare, zoneId: string) => (record: DnsRecord) =>
  Effect.logInfo(`Adding ${record.domain} → ${record.ip}`).pipe(
    Effect.annotateLogs({ service: "cloudflare", operation: "add", domain: record.domain }),
    Effect.andThen(
      withTimeout(withRetry(Effect.tryPromise({
        try: () =>
          client.dns.records.create({
            zone_id: zoneId,
            type: "A",
            name: record.domain,
            content: record.ip,
            ttl: 1,
            proxied: false
          }),
        catch: wrapError
      })))
    ),
    Effect.filterOrFail(
      (created) => created.content != null,
      (created) => new DnsProviderError({
        provider: PROVIDER_NAME,
        message: `Cloudflare returned null content for ${created.name}`
      })
    ),
    Effect.flatMap((created) =>
      parseProviderDnsRecord(created.name, created.content!, created.id).pipe(
        Effect.mapError((e) =>
          new DnsProviderError({
            provider: PROVIDER_NAME,
            message: `Cloudflare returned invalid record: ${e.message}`
          })
        )
      )
    ),
    Effect.tap(() =>
      Effect.logInfo(`Added ${record.domain}`).pipe(
        Effect.annotateLogs({ service: "cloudflare", operation: "add", domain: record.domain })
      )
    ),
    Effect.withSpan("CloudflareProvider.add")
  )

// Remove a record by domain (idempotent - succeeds if record doesn't exist)
const remove = (client: Cloudflare, zoneId: string, findFn: (domain: Domain) => Effect.Effect<Option.Option<ProviderDnsRecord>, DnsProviderErrors>) =>
  (domain: Domain) =>
    Effect.logInfo(`Removing ${domain}`).pipe(
      Effect.annotateLogs({ service: "cloudflare", operation: "remove", domain }),
      Effect.andThen(findFn(domain)),
      Effect.flatMap(Option.match({
        onNone: () =>
          Effect.logDebug(`${domain} not found, nothing to remove`).pipe(
            Effect.annotateLogs({ service: "cloudflare", operation: "remove", domain })
          ),
        onSome: (existing) =>
          withTimeout(withRetry(Effect.tryPromise({
            try: () =>
              client.dns.records.delete(existing.recordId, {
                zone_id: zoneId
              }),
            catch: wrapError
          }))).pipe(
            Effect.andThen(
              Effect.logInfo(`Removed ${domain}`).pipe(
                Effect.annotateLogs({ service: "cloudflare", operation: "remove", domain })
              )
            )
          )
      })),
      Effect.withSpan("CloudflareProvider.remove")
    )

// Upsert - add if not exists, update if IP changed
const upsert = (
  client: Cloudflare,
  zoneId: string,
  findFn: (domain: Domain) => Effect.Effect<Option.Option<ProviderDnsRecord>, DnsProviderErrors>,
  addFn: (record: DnsRecord) => Effect.Effect<ProviderDnsRecord, DnsProviderErrors>
) => (record: DnsRecord) =>
  findFn(record.domain).pipe(
    Effect.flatMap(Option.match({
      onNone: () => addFn(record),
      onSome: (existing) =>
        existing.ip === record.ip
          ? Effect.logInfo(`${record.domain} already up to date`).pipe(
              Effect.annotateLogs({ service: "cloudflare", operation: "upsert", domain: record.domain }),
              Effect.as(existing)
            )
          : Effect.logInfo(`Updating ${record.domain} → ${record.ip}`).pipe(
              Effect.annotateLogs({ service: "cloudflare", operation: "upsert", domain: record.domain }),
              Effect.andThen(
                withTimeout(withRetry(Effect.tryPromise({
                  try: () =>
                    client.dns.records.update(existing.recordId, {
                      zone_id: zoneId,
                      type: "A",
                      name: record.domain,
                      content: record.ip,
                      ttl: 1,
                      proxied: false
                    }),
                  catch: wrapError
                })))
              ),
              Effect.filterOrFail(
                (updated) => updated.content != null,
                () => new DnsProviderError({
                  provider: PROVIDER_NAME,
                  message: `Cloudflare returned null content for ${record.domain}`
                })
              ),
              Effect.flatMap((updated) =>
                parseProviderDnsRecord(updated.name, updated.content!, updated.id).pipe(
                  Effect.mapError((e) =>
                    new DnsProviderError({
                      provider: PROVIDER_NAME,
                      message: `Cloudflare returned invalid record: ${e.message}`
                    })
                  )
                )
              ),
              Effect.tap(() =>
                Effect.logInfo(`Updated ${record.domain}`).pipe(
                  Effect.annotateLogs({ service: "cloudflare", operation: "upsert", domain: record.domain })
                )
              )
            )
    })),
    Effect.withSpan("CloudflareProvider.upsert")
  )

// Create Cloudflare provider layer from config
export const makeCloudflareProvider = (config: CloudflareConfig): Layer.Layer<DnsProvider> =>
  Layer.scoped(
    DnsProvider,
    Effect.gen(function* () {
      // Acquire the Cloudflare client with proper resource management
      const client = yield* Effect.acquireRelease(
        Effect.sync(() => {
          return new Cloudflare({ apiToken: Redacted.value(config.apiToken) })
        }),
        (_client) =>
          Effect.logDebug("Cloudflare SDK released").pipe(
            Effect.annotateLogs({ service: "cloudflare" })
          )
      )

      const { zoneId } = config

      // Create bound functions with client and zoneId captured
      const listFn = list(client, zoneId)
      const findFn = find(client, zoneId)
      const addFn = add(client, zoneId)
      const removeFn = remove(client, zoneId, findFn)
      const upsertFn = upsert(client, zoneId, findFn, addFn)

      yield* Effect.logDebug("Cloudflare provider initialized").pipe(
        Effect.annotateLogs({ service: "cloudflare", zoneId })
      )

      return DnsProvider.of({
        name: PROVIDER_NAME,
        list: () => listFn,
        find: findFn,
        add: addFn,
        remove: removeFn,
        upsert: upsertFn
      })
    })
  )
