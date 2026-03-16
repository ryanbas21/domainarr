import { Context, Effect, Either, Layer, Schema } from "effect"
import { PiholeClient } from "./PiholeClient.js"
import { DnsProvider, type DnsProviderErrors } from "./DnsProvider.js"
import { DnsRecord, type Domain } from "../domain/DnsRecord.js"
import type { PiholeError } from "../domain/errors.js"

// Combined record with status from both providers
export class ManagedDnsRecord extends Schema.Class<ManagedDnsRecord>("ManagedDnsRecord")({
  domain: Schema.String,
  ip: Schema.String,
  inPihole: Schema.Boolean,
  inDnsProvider: Schema.Boolean,
  dnsRecordId: Schema.optional(Schema.String)
}) {}

// Result type for operations that touch both providers
export interface SyncResult {
  readonly domain: string
  readonly pihole: "success" | "failed" | "skipped"
  readonly dnsProvider: "success" | "failed" | "skipped"
  readonly piholeError?: string
  readonly dnsProviderError?: string
}

export class DomainManager extends Context.Tag("@domainarr/DomainManager")<
  DomainManager,
  {
    readonly list: () => Effect.Effect<
      ReadonlyArray<ManagedDnsRecord>,
      PiholeError | DnsProviderErrors
    >
    readonly add: (record: DnsRecord) => Effect.Effect<SyncResult, never>
    readonly remove: (domain: Domain) => Effect.Effect<SyncResult, never>
    readonly sync: () => Effect.Effect<ReadonlyArray<SyncResult>, PiholeError>
  }
>() {
  static readonly layer = Layer.effect(
    DomainManager,
    Effect.gen(function* () {
      const pihole = yield* PiholeClient
      const dnsProvider = yield* DnsProvider

      // List records from both providers and merge them
      const list = Effect.fn("DomainManager.list")(function* () {
        const [piholeRecords, dnsProviderRecords] = yield* Effect.all([
          pihole.list(),
          dnsProvider.list()
        ])

        const recordMap = new Map<string, ManagedDnsRecord>()

        for (const record of piholeRecords) {
          recordMap.set(
            record.domain,
            ManagedDnsRecord.make({
              domain: record.domain,
              ip: record.ip,
              inPihole: true,
              inDnsProvider: false
            })
          )
        }

        for (const record of dnsProviderRecords) {
          const existing = recordMap.get(record.domain)
          if (existing) {
            recordMap.set(
              record.domain,
              ManagedDnsRecord.make({
                ...existing,
                inDnsProvider: true,
                dnsRecordId: record.recordId
              })
            )
          } else {
            recordMap.set(
              record.domain,
              ManagedDnsRecord.make({
                domain: record.domain,
                ip: record.ip,
                inPihole: false,
                inDnsProvider: true,
                dnsRecordId: record.recordId
              })
            )
          }
        }

        return Array.from(recordMap.values()).sort((a, b) =>
          a.domain.localeCompare(b.domain)
        )
      })

      // Add to both providers (best effort - reports individual failures)
      const add = Effect.fn("DomainManager.add")(function* (record: DnsRecord) {
        // Add to Pi-hole
        const piholeResult = yield* pihole.add(record).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll((e) =>
            Effect.succeed({ success: false as const, error: e.message })
          )
        )

        // Add to DNS provider
        const dnsProviderResult = yield* dnsProvider.add(record).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll((e) =>
            Effect.succeed({ success: false as const, error: e.message })
          )
        )

        // Build immutable result
        const result: SyncResult = {
          domain: record.domain,
          pihole: piholeResult.success ? "success" : "failed",
          dnsProvider: dnsProviderResult.success ? "success" : "failed",
          ...(piholeResult.success ? {} : { piholeError: piholeResult.error }),
          ...(dnsProviderResult.success ? {} : { dnsProviderError: dnsProviderResult.error })
        }

        return result
      })

      // Remove from both providers
      const remove = Effect.fn("DomainManager.remove")(function* (domain: Domain) {
        // First, get the current record from Pi-hole to get the IP
        const piholeListResult = yield* pihole.list().pipe(Effect.either)

        // Log if we failed to list Pi-hole records
        if (Either.isLeft(piholeListResult)) {
          yield* Effect.logWarning(`Failed to fetch Pi-hole records: ${piholeListResult.left.message}`).pipe(
            Effect.annotateLogs({ service: "domain-manager", operation: "remove", domain })
          )
        }

        const piholeRecords = Either.isRight(piholeListResult) ? piholeListResult.right : []
        const piholeRecord = piholeRecords.find((r) => r.domain === domain)

        // Remove from Pi-hole
        let piholeStatus: "success" | "failed" | "skipped" = "skipped"
        let piholeError: string | undefined

        // If list failed, we can't remove from Pi-hole - mark as failed with the list error
        if (Either.isLeft(piholeListResult)) {
          piholeStatus = "failed"
          piholeError = `Could not verify record exists: ${piholeListResult.left.message}`
        } else if (piholeRecord) {
          const result = yield* pihole.remove(piholeRecord).pipe(
            Effect.map(() => ({ success: true as const })),
            Effect.catchAll((e) =>
              Effect.succeed({ success: false as const, error: e.message })
            )
          )
          piholeStatus = result.success ? "success" : "failed"
          piholeError = result.success ? undefined : result.error
        }

        // Remove from DNS provider
        const dnsResult = yield* dnsProvider.remove(domain).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll((e) =>
            Effect.succeed({ success: false as const, error: e.message })
          )
        )

        return {
          domain,
          pihole: piholeStatus,
          dnsProvider: dnsResult.success ? "success" : "failed",
          ...(piholeError ? { piholeError } : {}),
          ...(dnsResult.success ? {} : { dnsProviderError: dnsResult.error })
        } as SyncResult
      })

      // Sync Pi-hole → DNS provider (Pi-hole is source of truth)
      const sync = Effect.fn("DomainManager.sync")(function* () {
        const piholeRecords = yield* pihole.list()

        const results: SyncResult[] = []

        for (const record of piholeRecords) {
          const dnsProviderResult = yield* dnsProvider.upsert(record).pipe(
            Effect.map(() => ({ success: true as const })),
            Effect.catchAll((e) =>
              Effect.succeed({ success: false as const, error: e.message })
            )
          )

          const result: SyncResult = {
            domain: record.domain,
            pihole: "success",
            dnsProvider: dnsProviderResult.success ? "success" : "failed",
            ...(dnsProviderResult.success ? {} : { dnsProviderError: dnsProviderResult.error })
          }
          results.push(result)
        }

        return results
      })

      return DomainManager.of({ list, add, remove, sync })
    })
  )
}
