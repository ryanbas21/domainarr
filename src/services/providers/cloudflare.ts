import { Duration, Effect, Layer, Option, Redacted, Schedule, Schema } from "effect"
import Cloudflare from "cloudflare"
import { DnsRecord, Domain, parseProviderDnsRecord } from "../../domain/DnsRecord.js"
import {
  DnsProvider,
  DnsProviderError,
  DnsProviderAuthError,
  DnsProviderRecordNotFoundError,
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
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: Duration.millis(500),
  maxDelay: Duration.seconds(10)
}

const retrySchedule = Schedule.exponential(RETRY_CONFIG.baseDelay).pipe(
  Schedule.jittered,
  Schedule.either(Schedule.recurs(RETRY_CONFIG.maxAttempts - 1)),
  Schedule.upTo(RETRY_CONFIG.maxDelay)
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
const list = (client: Cloudflare, zoneId: string) =>
  Effect.gen(function* () {
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
  }).pipe(Effect.withSpan("CloudflareProvider.list"))

// Find a specific record by domain
const find = (client: Cloudflare, zoneId: string) => (domain: Domain) =>
  Effect.gen(function* () {
    const rawRecords = yield* withTimeout(withRetry(Effect.tryPromise({
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
    })))

    if (rawRecords.length === 0) {
      return Option.none()
    }

    const raw = rawRecords[0]
    const parsed = yield* parseProviderDnsRecord(raw.name, raw.content, raw.id).pipe(
      Effect.catchAll((e) =>
        Effect.logWarning(`Invalid record format for "${raw.name}": ${e.message}`).pipe(
          Effect.annotateLogs({ service: "cloudflare" }),
          Effect.as(null)
        )
      )
    )

    return parsed !== null ? Option.some(parsed) : Option.none()
  }).pipe(Effect.withSpan("CloudflareProvider.find"))

// Add a new A record
const add = (client: Cloudflare, zoneId: string) => (record: DnsRecord) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Adding ${record.domain} → ${record.ip}`).pipe(
      Effect.annotateLogs({ service: "cloudflare", operation: "add", domain: record.domain })
    )

    const created = yield* withTimeout(withRetry(Effect.tryPromise({
      try: () =>
        client.dns.records.create({
          zone_id: zoneId,
          type: "A",
          name: record.domain,
          content: record.ip,
          ttl: 1, // TTL of 1 tells Cloudflare to use automatic TTL management
          proxied: false // Local DNS should not be proxied
        }),
      catch: wrapError
    })))

    // Validate response from Cloudflare API
    const result = yield* parseProviderDnsRecord(created.name, created.content as string, created.id).pipe(
      Effect.mapError((e) =>
        new DnsProviderError({
          provider: PROVIDER_NAME,
          message: `Cloudflare returned invalid record: ${e.message}`
        })
      )
    )

    yield* Effect.logInfo(`Added ${record.domain}`).pipe(
      Effect.annotateLogs({ service: "cloudflare", operation: "add", domain: record.domain })
    )
    return result
  }).pipe(Effect.withSpan("CloudflareProvider.add"))

// Remove a record by domain
const remove = (client: Cloudflare, zoneId: string, findFn: (domain: Domain) => Effect.Effect<Option.Option<ProviderDnsRecord>, DnsProviderErrors>) =>
  (domain: Domain) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`Removing ${domain}`).pipe(
        Effect.annotateLogs({ service: "cloudflare", operation: "remove", domain })
      )

      const existing = yield* findFn(domain)
      if (Option.isNone(existing)) {
        return yield* new DnsProviderRecordNotFoundError({
          provider: PROVIDER_NAME,
          domain
        })
      }

      yield* withTimeout(withRetry(Effect.tryPromise({
        try: () =>
          client.dns.records.delete(existing.value.recordId, {
            zone_id: zoneId
          }),
        catch: wrapError
      })))

      yield* Effect.logInfo(`Removed ${domain}`).pipe(
        Effect.annotateLogs({ service: "cloudflare", operation: "remove", domain })
      )
    }).pipe(Effect.withSpan("CloudflareProvider.remove"))

// Upsert - add if not exists, update if IP changed
const upsert = (
  client: Cloudflare,
  zoneId: string,
  findFn: (domain: Domain) => Effect.Effect<Option.Option<ProviderDnsRecord>, DnsProviderErrors>,
  addFn: (record: DnsRecord) => Effect.Effect<ProviderDnsRecord, DnsProviderErrors>
) => (record: DnsRecord) =>
  Effect.gen(function* () {
    const existing = yield* findFn(record.domain)

    if (Option.isSome(existing)) {
      // Record exists - check if IP changed
      if (existing.value.ip === record.ip) {
        yield* Effect.logInfo(`${record.domain} already up to date`).pipe(
          Effect.annotateLogs({ service: "cloudflare", operation: "upsert", domain: record.domain })
        )
        return existing.value
      }

      // Update existing record
      yield* Effect.logInfo(`Updating ${record.domain} → ${record.ip}`).pipe(
        Effect.annotateLogs({ service: "cloudflare", operation: "upsert", domain: record.domain })
      )

      const updated = yield* withTimeout(withRetry(Effect.tryPromise({
        try: () =>
          client.dns.records.update(existing.value.recordId, {
            zone_id: zoneId,
            type: "A",
            name: record.domain,
            content: record.ip,
            ttl: 1,
            proxied: false
          }),
        catch: wrapError
      })))

      // Validate response
      const result = yield* parseProviderDnsRecord(updated.name, updated.content as string, updated.id).pipe(
        Effect.mapError((e) =>
          new DnsProviderError({
            provider: PROVIDER_NAME,
            message: `Cloudflare returned invalid record: ${e.message}`
          })
        )
      )

      yield* Effect.logInfo(`Updated ${record.domain}`).pipe(
        Effect.annotateLogs({ service: "cloudflare", operation: "upsert", domain: record.domain })
      )
      return result
    }

    // Create new record
    return yield* addFn(record)
  }).pipe(Effect.withSpan("CloudflareProvider.upsert"))

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
