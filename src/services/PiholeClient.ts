import { Context, Duration, Effect, Layer, Option, Redacted, Ref, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform"
import { AppConfig } from "../config/AppConfig.js"
import { DnsRecord, parseDnsRecord } from "../domain/DnsRecord.js"
import {
  PiholeAuthError,
  PiholeApiError,
  PiholeConnectionError,
  type PiholeError
} from "../domain/errors.js"

// Configuration
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: Duration.millis(500),
  maxDelay: Duration.seconds(5)
}

const HTTP_TIMEOUT = Duration.seconds(30)

// Schedule with exponential backoff and jitter, limited to maxAttempts
const retrySchedule = Schedule.exponential(RETRY_CONFIG.baseDelay).pipe(
  Schedule.jittered,
  Schedule.either(Schedule.recurs(RETRY_CONFIG.maxAttempts - 1)),
  Schedule.upTo(RETRY_CONFIG.maxDelay)
)

// Determine if an error is retryable (transient)
const isRetryable = (error: PiholeError): boolean =>
  error._tag === "PiholeAuthError" ||
  error._tag === "PiholeConnectionError" ||
  (error._tag === "PiholeApiError" && error.status !== undefined && error.status >= 500)

// Session state type
interface PiholeSession {
  readonly sid: string
  readonly csrf: string
}

// Pi-hole auth response schema
const AuthResponse = Schema.Struct({
  session: Schema.Struct({
    valid: Schema.Boolean,
    sid: Schema.String,
    csrf: Schema.String
  })
})

// Pi-hole DNS hosts response - array of "IP domain" strings
const DnsHostsResponse = Schema.Struct({
  config: Schema.Struct({
    dns: Schema.Struct({
      hosts: Schema.Array(Schema.String)
    })
  })
})

export class PiholeClient extends Context.Tag("@domainarr/PiholeClient")<
  PiholeClient,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<DnsRecord>, PiholeError>
    readonly add: (record: DnsRecord) => Effect.Effect<void, PiholeError>
    readonly remove: (record: DnsRecord) => Effect.Effect<void, PiholeError>
  }
>() {
  static readonly layer = Layer.effect(
    PiholeClient,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const http = yield* HttpClient.HttpClient

      const baseUrl = config.pihole.url.replace(/\/$/, "")

      // Session state using Ref for fiber-safe state management
      const sessionRef = yield* Ref.make<Option.Option<PiholeSession>>(Option.none())

      // Authenticate and get session
      const authenticate = (): Effect.Effect<void, PiholeError> =>
        Effect.gen(function* () {
          yield* Effect.logDebug("Authenticating with Pi-hole").pipe(
            Effect.annotateLogs({ service: "pihole", operation: "auth" })
          )

          const request = yield* HttpClientRequest.post(`${baseUrl}/api/auth`).pipe(
            HttpClientRequest.bodyJson({
              password: Redacted.value(config.pihole.password)
            }),
            Effect.mapError((e) =>
              new PiholeAuthError({ message: `Body creation failed: ${e}` })
            )
          )

          const response = yield* http.execute(request).pipe(
            Effect.timeout(HTTP_TIMEOUT),
            Effect.catchTag("TimeoutException", () =>
              Effect.fail(new PiholeConnectionError({
                message: `Request timed out after ${Duration.toSeconds(HTTP_TIMEOUT)}s`,
                url: baseUrl
              }))
            ),
            Effect.mapError((e) =>
              new PiholeConnectionError({
                message: `Connection failed: ${e instanceof Error ? e.message : String(e)}`,
                url: baseUrl
              })
            )
          )

          const body = yield* HttpClientResponse.schemaBodyJson(AuthResponse)(response).pipe(
            Effect.mapError((e) =>
              new PiholeAuthError({ message: `Auth parse failed: ${e}` })
            )
          )

          if (!body.session.valid) {
            return yield* new PiholeAuthError({ message: "Invalid session" })
          }

          yield* Ref.set(sessionRef, Option.some({
            sid: body.session.sid,
            csrf: body.session.csrf
          }))

          yield* Effect.logDebug("Authentication successful").pipe(
            Effect.annotateLogs({ service: "pihole", operation: "auth" })
          )
        })

      // Ensure we have a valid session, returns session data
      const ensureSession = (): Effect.Effect<PiholeSession, PiholeError> =>
        Effect.gen(function* () {
          const session = yield* Ref.get(sessionRef)
          if (Option.isNone(session)) {
            yield* authenticate()
            const newSession = yield* Ref.get(sessionRef)
            if (Option.isNone(newSession)) {
              return yield* new PiholeAuthError({ message: "Failed to establish session" })
            }
            return newSession.value
          }
          return session.value
        })

      // Clear session (on 401 response)
      const clearSession = (): Effect.Effect<void> =>
        Ref.set(sessionRef, Option.none())

      // Internal list implementation (handles single attempt)
      const listInternal = (): Effect.Effect<ReadonlyArray<DnsRecord>, PiholeError> =>
        Effect.gen(function* () {
          const session = yield* ensureSession()

          const request = HttpClientRequest.get(`${baseUrl}/api/config/dns/hosts`).pipe(
            HttpClientRequest.setHeader("X-CSRF-Token", session.csrf),
            HttpClientRequest.setHeader("Cookie", `sid=${session.sid}`)
          )

          const response = yield* http.execute(request).pipe(
            Effect.timeout(HTTP_TIMEOUT),
            Effect.catchTag("TimeoutException", () =>
              Effect.fail(new PiholeConnectionError({
                message: `Request timed out after ${Duration.toSeconds(HTTP_TIMEOUT)}s`,
                url: baseUrl
              }))
            ),
            Effect.mapError((e) =>
              new PiholeConnectionError({
                message: `Request failed: ${e instanceof Error ? e.message : String(e)}`,
                url: baseUrl
              })
            )
          )

          if (response.status === 401) {
            // Clear session and fail - will be retried by schedule
            yield* clearSession()
            return yield* new PiholeAuthError({
              message: "Session expired, re-authentication required"
            })
          }

          if (response.status >= 400) {
            return yield* new PiholeApiError({
              message: `HTTP ${response.status}`,
              status: response.status
            })
          }

          const body = yield* HttpClientResponse.schemaBodyJson(DnsHostsResponse)(response).pipe(
            Effect.mapError((e) =>
              new PiholeApiError({ message: `Parse failed: ${e}` })
            )
          )

          // Parse "IP domain" strings into DnsRecord objects with validation
          const records = yield* Effect.forEach(
            body.config.dns.hosts,
            (entry) => {
              const parts = entry.split(" ")
              if (parts.length >= 2) {
                const [ip, domain] = parts
                return parseDnsRecord(domain, ip).pipe(
                  Effect.catchAll((e) =>
                    Effect.logWarning(`Skipping malformed Pi-hole entry "${entry}": ${e.message}`).pipe(
                      Effect.annotateLogs({ service: "pihole" }),
                      Effect.as(null)
                    )
                  )
                )
              }
              return Effect.logWarning(`Skipping malformed Pi-hole entry (wrong format): "${entry}"`).pipe(
                Effect.annotateLogs({ service: "pihole" }),
                Effect.as(null)
              )
            },
            { concurrency: 1 }
          )

          return records.filter((r): r is DnsRecord => r !== null)
        })

      // List all DNS records with retry on transient errors
      const list = (): Effect.Effect<ReadonlyArray<DnsRecord>, PiholeError> =>
        listInternal().pipe(
          Effect.retry({
            schedule: retrySchedule,
            while: isRetryable
          }),
          Effect.mapError((e) =>
            new PiholeApiError({
              message: `Operation failed after ${RETRY_CONFIG.maxAttempts} attempts: ${e.message}`
            })
          )
        )

      // Internal add implementation (handles single attempt)
      const addInternal = (record: DnsRecord): Effect.Effect<void, PiholeError> =>
        Effect.gen(function* () {
          const session = yield* ensureSession()
          yield* Effect.logInfo(`Adding ${record.domain} → ${record.ip}`).pipe(
            Effect.annotateLogs({ service: "pihole", operation: "add", domain: record.domain })
          )

          const encoded = record.piholeEncoded
          const request = HttpClientRequest.put(`${baseUrl}/api/config/dns/hosts/${encoded}`).pipe(
            HttpClientRequest.setHeader("X-CSRF-Token", session.csrf),
            HttpClientRequest.setHeader("Cookie", `sid=${session.sid}`)
          )

          const response = yield* http.execute(request).pipe(
            Effect.timeout(HTTP_TIMEOUT),
            Effect.catchTag("TimeoutException", () =>
              Effect.fail(new PiholeConnectionError({
                message: `Request timed out after ${Duration.toSeconds(HTTP_TIMEOUT)}s`,
                url: baseUrl
              }))
            ),
            Effect.mapError((e) =>
              new PiholeConnectionError({
                message: `Add failed: ${e instanceof Error ? e.message : String(e)}`,
                url: baseUrl
              })
            )
          )

          if (response.status === 401) {
            yield* clearSession()
            return yield* new PiholeAuthError({
              message: "Session expired, re-authentication required"
            })
          }

          if (response.status >= 400) {
            return yield* new PiholeApiError({
              message: `Failed to add record: HTTP ${response.status}`,
              status: response.status
            })
          }

          yield* Effect.logInfo(`Added ${record.domain}`).pipe(
            Effect.annotateLogs({ service: "pihole", operation: "add", domain: record.domain })
          )
        })

      // Add a DNS record with retry on transient errors
      const add = (record: DnsRecord): Effect.Effect<void, PiholeError> =>
        addInternal(record).pipe(
          Effect.retry({
            schedule: retrySchedule,
            while: isRetryable
          })
        )

      // Internal remove implementation (handles single attempt)
      const removeInternal = (record: DnsRecord): Effect.Effect<void, PiholeError> =>
        Effect.gen(function* () {
          const session = yield* ensureSession()
          yield* Effect.logInfo(`Removing ${record.domain}`).pipe(
            Effect.annotateLogs({ service: "pihole", operation: "remove", domain: record.domain })
          )

          const encoded = record.piholeEncoded
          const request = HttpClientRequest.del(`${baseUrl}/api/config/dns/hosts/${encoded}`).pipe(
            HttpClientRequest.setHeader("X-CSRF-Token", session.csrf),
            HttpClientRequest.setHeader("Cookie", `sid=${session.sid}`)
          )

          const response = yield* http.execute(request).pipe(
            Effect.timeout(HTTP_TIMEOUT),
            Effect.catchTag("TimeoutException", () =>
              Effect.fail(new PiholeConnectionError({
                message: `Request timed out after ${Duration.toSeconds(HTTP_TIMEOUT)}s`,
                url: baseUrl
              }))
            ),
            Effect.mapError((e) =>
              new PiholeConnectionError({
                message: `Remove failed: ${e instanceof Error ? e.message : String(e)}`,
                url: baseUrl
              })
            )
          )

          if (response.status === 401) {
            yield* clearSession()
            return yield* new PiholeAuthError({
              message: "Session expired, re-authentication required"
            })
          }

          if (response.status >= 400) {
            return yield* new PiholeApiError({
              message: `Failed to remove record: HTTP ${response.status}`,
              status: response.status
            })
          }

          yield* Effect.logInfo(`Removed ${record.domain}`).pipe(
            Effect.annotateLogs({ service: "pihole", operation: "remove", domain: record.domain })
          )
        })

      // Remove a DNS record with retry on transient errors
      const remove = (record: DnsRecord): Effect.Effect<void, PiholeError> =>
        removeInternal(record).pipe(
          Effect.retry({
            schedule: retrySchedule,
            while: isRetryable
          })
        )

      return PiholeClient.of({ list, add, remove })
    })
  )
}
