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
  baseDelay: Duration.millis(500)
}

const HTTP_TIMEOUT = Duration.seconds(30)

// Exponential backoff with jitter, capped at maxAttempts retries.
// Uses && (both) semantics: apply exponential delays AND stop after N retries.
const retrySchedule = Schedule.exponential(RETRY_CONFIG.baseDelay).pipe(
  Schedule.jittered,
  (s) => Schedule.intersect(s, Schedule.recurs(RETRY_CONFIG.maxAttempts - 1))
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

      // Helper: execute HTTP request with timeout and unified error mapping
      const executeWithTimeout = (request: HttpClientRequest.HttpClientRequest, context: string) =>
        http.execute(request).pipe(
          Effect.timeout(HTTP_TIMEOUT),
          Effect.catchAll((e) => {
            if ("_tag" in e && e._tag === "TimeoutException") {
              return Effect.fail(new PiholeConnectionError({
                message: `Request timed out after ${Duration.toSeconds(HTTP_TIMEOUT)}s`,
                url: baseUrl
              }))
            }
            return Effect.fail(new PiholeConnectionError({
              message: `${context}: ${e instanceof Error ? e.message : String(e)}`,
              url: baseUrl
            }))
          })
        )

      // Authenticate and get session
      const authenticate = (): Effect.Effect<void, PiholeError> =>
        Effect.logDebug("Authenticating with Pi-hole").pipe(
          Effect.annotateLogs({ service: "pihole", operation: "auth" }),
          Effect.andThen(
            HttpClientRequest.post(`${baseUrl}/api/auth`).pipe(
              HttpClientRequest.bodyJson({
                password: Redacted.value(config.pihole.password)
              }),
              Effect.mapError((e) =>
                new PiholeAuthError({ message: `Body creation failed: ${e}` })
              )
            )
          ),
          Effect.flatMap((request) => executeWithTimeout(request, "Connection failed")),
          Effect.flatMap((response) =>
            HttpClientResponse.schemaBodyJson(AuthResponse)(response).pipe(
              Effect.mapError((e) =>
                new PiholeAuthError({ message: `Auth parse failed: ${e}` })
              )
            )
          ),
          Effect.filterOrFail(
            (body) => body.session.valid,
            () => new PiholeAuthError({ message: "Invalid session" })
          ),
          Effect.tap((body) =>
            Ref.set(sessionRef, Option.some({
              sid: body.session.sid,
              csrf: body.session.csrf
            }))
          ),
          Effect.andThen(
            Effect.logDebug("Authentication successful").pipe(
              Effect.annotateLogs({ service: "pihole", operation: "auth" })
            )
          )
        )

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

      // Check response status and fail on auth/API errors
      const checkResponse = (response: { status: number }, context: string) =>
        response.status === 401
          ? clearSession().pipe(
              Effect.andThen(Effect.fail(new PiholeAuthError({
                message: "Session expired, re-authentication required"
              })))
            )
          : response.status >= 400
            ? Effect.fail(new PiholeApiError({
                message: `${context}: HTTP ${response.status}`,
                status: response.status
              }))
            : Effect.void

      // Internal list implementation (handles single attempt)
      const listInternal = (): Effect.Effect<ReadonlyArray<DnsRecord>, PiholeError> =>
        ensureSession().pipe(
          Effect.flatMap((session) => {
            const request = HttpClientRequest.get(`${baseUrl}/api/config/dns/hosts`).pipe(
              HttpClientRequest.setHeader("X-CSRF-Token", session.csrf),
              HttpClientRequest.setHeader("Cookie", `sid=${session.sid}`)
            )
            return executeWithTimeout(request, "Request failed")
          }),
          Effect.tap((response) => checkResponse(response, "List failed")),
          Effect.flatMap((response) =>
            HttpClientResponse.schemaBodyJson(DnsHostsResponse)(response).pipe(
              Effect.mapError((e) =>
                new PiholeApiError({ message: `Parse failed: ${e}` })
              )
            )
          ),
          Effect.flatMap((body) =>
            Effect.forEach(
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
          ),
          Effect.map((records) => records.filter((r): r is DnsRecord => r !== null))
        )

      // List all DNS records with retry on transient errors
      const list = (): Effect.Effect<ReadonlyArray<DnsRecord>, PiholeError> =>
        listInternal().pipe(
          Effect.retry({
            schedule: retrySchedule,
            while: isRetryable
          })
        )

      // Internal add implementation (handles single attempt)
      const addInternal = (record: DnsRecord): Effect.Effect<void, PiholeError> =>
        ensureSession().pipe(
          Effect.tap(() =>
            Effect.logInfo(`Adding ${record.domain} → ${record.ip}`).pipe(
              Effect.annotateLogs({ service: "pihole", operation: "add", domain: record.domain })
            )
          ),
          Effect.flatMap((session) => {
            const request = HttpClientRequest.put(`${baseUrl}/api/config/dns/hosts/${record.piholeEncoded}`).pipe(
              HttpClientRequest.setHeader("X-CSRF-Token", session.csrf),
              HttpClientRequest.setHeader("Cookie", `sid=${session.sid}`)
            )
            return executeWithTimeout(request, "Add failed")
          }),
          Effect.tap((response) => checkResponse(response, "Failed to add record")),
          Effect.andThen(
            Effect.logInfo(`Added ${record.domain}`).pipe(
              Effect.annotateLogs({ service: "pihole", operation: "add", domain: record.domain })
            )
          )
        )

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
        ensureSession().pipe(
          Effect.tap(() =>
            Effect.logInfo(`Removing ${record.domain}`).pipe(
              Effect.annotateLogs({ service: "pihole", operation: "remove", domain: record.domain })
            )
          ),
          Effect.flatMap((session) => {
            const request = HttpClientRequest.del(`${baseUrl}/api/config/dns/hosts/${record.piholeEncoded}`).pipe(
              HttpClientRequest.setHeader("X-CSRF-Token", session.csrf),
              HttpClientRequest.setHeader("Cookie", `sid=${session.sid}`)
            )
            return executeWithTimeout(request, "Remove failed")
          }),
          Effect.tap((response) => checkResponse(response, "Failed to remove record")),
          Effect.andThen(
            Effect.logInfo(`Removed ${record.domain}`).pipe(
              Effect.annotateLogs({ service: "pihole", operation: "remove", domain: record.domain })
            )
          )
        )

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
