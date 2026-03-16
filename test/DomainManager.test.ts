/**
 * Tests for DomainManager service.
 *
 * DomainManager orchestrates operations between PiholeClient and DnsProvider,
 * providing merged views and best-effort sync operations.
 */
import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { DomainManager, ManagedDnsRecord } from "../src/services/DomainManager.js"
import { PiholeClient } from "../src/services/PiholeClient.js"
import { DnsProvider, DnsProviderError } from "../src/services/DnsProvider.js"
import { DnsRecord, type Domain, type IpAddress } from "../src/domain/DnsRecord.js"
import { PiholeApiError } from "../src/domain/errors.js"
import {
  makeMockPiholeClient,
  makeMockDnsProvider,
  makeTestRecord,
  makeTestProviderRecord
} from "./helpers.js"

// ============================================================================
// List Operation Tests
// ============================================================================

describe("DomainManager.list", () => {
  it.effect("merges records from both providers", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({
        records: [
          makeTestRecord("shared.example.com", "192.168.1.1"),
          makeTestRecord("pihole-only.example.com", "192.168.1.2")
        ]
      })

      const dnsProviderLayer = makeMockDnsProvider({
        records: [
          makeTestProviderRecord("shared.example.com", "192.168.1.1", "cf-1"),
          makeTestProviderRecord("cf-only.example.com", "192.168.1.3", "cf-2")
        ]
      })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const records = yield* manager.list()

      expect(records).toHaveLength(3)

      // Find each record and verify status
      const shared = records.find((r) => r.domain === "shared.example.com")
      const piholeOnly = records.find((r) => r.domain === "pihole-only.example.com")
      const cfOnly = records.find((r) => r.domain === "cf-only.example.com")

      expect(shared?.inPihole).toBe(true)
      expect(shared?.inDnsProvider).toBe(true)
      expect(shared?.dnsRecordId).toBe("cf-1")

      expect(piholeOnly?.inPihole).toBe(true)
      expect(piholeOnly?.inDnsProvider).toBe(false)
      expect(piholeOnly?.dnsRecordId).toBeUndefined()

      expect(cfOnly?.inPihole).toBe(false)
      expect(cfOnly?.inDnsProvider).toBe(true)
      expect(cfOnly?.dnsRecordId).toBe("cf-2")
    })
  )

  it.effect("returns empty array when both providers are empty", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({ records: [] })
      const dnsProviderLayer = makeMockDnsProvider({ records: [] })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const records = yield* manager.list()

      expect(records).toEqual([])
    })
  )

  it.effect("returns sorted records by domain name", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({
        records: [
          makeTestRecord("zebra.example.com", "1.1.1.1"),
          makeTestRecord("alpha.example.com", "2.2.2.2"),
          makeTestRecord("middle.example.com", "3.3.3.3")
        ]
      })

      const dnsProviderLayer = makeMockDnsProvider({ records: [] })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const records = yield* manager.list()

      expect(records[0].domain).toBe("alpha.example.com")
      expect(records[1].domain).toBe("middle.example.com")
      expect(records[2].domain).toBe("zebra.example.com")
    })
  )

  it.effect("tracks IP divergence between providers", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({
        records: [
          makeTestRecord("same-ip.example.com", "192.168.1.1"),
          makeTestRecord("diff-ip.example.com", "192.168.1.2")
        ]
      })

      const dnsProviderLayer = makeMockDnsProvider({
        records: [
          makeTestProviderRecord("same-ip.example.com", "192.168.1.1", "cf-1"),
          makeTestProviderRecord("diff-ip.example.com", "10.0.0.99", "cf-2")
        ]
      })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const records = yield* manager.list()

      const sameIp = records.find((r) => r.domain === "same-ip.example.com")
      const diffIp = records.find((r) => r.domain === "diff-ip.example.com")

      // Same IP: no divergence
      expect(sameIp?.dnsProviderIp).toBeUndefined()
      expect(sameIp?.ip).toBe("192.168.1.1")

      // Different IP: dnsProviderIp populated with the DNS provider's IP
      expect(diffIp?.dnsProviderIp).toBe("10.0.0.99")
      expect(diffIp?.ip).toBe("192.168.1.2") // Pi-hole IP preserved
    })
  )

  it.effect("propagates Pi-hole errors", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({
        error: new PiholeApiError({ message: "Connection failed" })
      })

      const dnsProviderLayer = makeMockDnsProvider({ records: [] })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const result = yield* manager.list().pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
  )

  it.effect("propagates DNS provider errors", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({ records: [] })

      const dnsProviderLayer = makeMockDnsProvider({
        error: new DnsProviderError({
          provider: "test",
          message: "API error"
        })
      })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const result = yield* manager.list().pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
  )
})

// ============================================================================
// Add Operation Tests
// ============================================================================

describe("DomainManager.add", () => {
  it.effect("adds to both providers successfully", () =>
    Effect.gen(function* () {
      const addedToPihole: DnsRecord[] = []
      const upsertedToProvider: DnsRecord[] = []

      const piholeLayer = makeMockPiholeClient({
        records: [],
        onAdd: (r) => addedToPihole.push(r)
      })

      const dnsProviderLayer = makeMockDnsProvider({
        records: [],
        onUpsert: (r) => upsertedToProvider.push(r)
      })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const record = makeTestRecord("new.example.com", "192.168.1.100")
      const result = yield* manager.add(record)

      expect(result.domain).toBe("new.example.com")
      expect(result.pihole).toBe("success")
      expect(result.dnsProvider).toBe("success")
      expect(result.piholeError).toBeUndefined()
      expect(result.dnsProviderError).toBeUndefined()

      expect(addedToPihole).toHaveLength(1)
      expect(upsertedToProvider).toHaveLength(1)
    })
  )

  it.effect("reports partial failure when Pi-hole fails", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({
        error: new PiholeApiError({ message: "Pi-hole is down" })
      })

      const dnsProviderLayer = makeMockDnsProvider({ records: [] })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const record = makeTestRecord("test.example.com", "1.2.3.4")
      const result = yield* manager.add(record)

      expect(result.pihole).toBe("failed")
      expect(result.dnsProvider).toBe("success")
      expect(result.piholeError).toBeDefined()
    })
  )

  it.effect("reports partial failure when DNS provider fails", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({ records: [] })

      const dnsProviderLayer = makeMockDnsProvider({
        error: new DnsProviderError({
          provider: "test",
          message: "Rate limited",
          code: 429
        })
      })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const record = makeTestRecord("test.example.com", "1.2.3.4")
      const result = yield* manager.add(record)

      expect(result.pihole).toBe("success")
      expect(result.dnsProvider).toBe("failed")
      expect(result.dnsProviderError).toBeDefined()
    })
  )

  it.effect("reports both failures when both providers fail", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({
        error: new PiholeApiError({ message: "Pi-hole error" })
      })

      const dnsProviderLayer = makeMockDnsProvider({
        error: new DnsProviderError({
          provider: "test",
          message: "Provider error"
        })
      })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const record = makeTestRecord("test.example.com", "1.2.3.4")
      const result = yield* manager.add(record)

      expect(result.pihole).toBe("failed")
      expect(result.dnsProvider).toBe("failed")
      expect(result.piholeError).toBeDefined()
      expect(result.dnsProviderError).toBeDefined()
    })
  )

  it.effect("updates existing Pi-hole record when IP changes", () =>
    Effect.gen(function* () {
      const removedFromPihole: DnsRecord[] = []
      const addedToPihole: DnsRecord[] = []

      const piholeLayer = makeMockPiholeClient({
        records: [makeTestRecord("existing.example.com", "192.168.1.1")],
        onRemove: (r) => removedFromPihole.push(r),
        onAdd: (r) => addedToPihole.push(r)
      })

      const dnsProviderLayer = makeMockDnsProvider({ records: [] })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      // Add same domain with different IP
      const record = makeTestRecord("existing.example.com", "10.0.0.1")
      const result = yield* manager.add(record)

      expect(result.pihole).toBe("success")
      // Should have removed old record and added new one
      expect(removedFromPihole).toHaveLength(1)
      expect(removedFromPihole[0].ip).toBe("192.168.1.1")
      expect(addedToPihole).toHaveLength(1)
      expect(addedToPihole[0].ip).toBe("10.0.0.1")
    })
  )

  it.effect("skips Pi-hole add when record already exists with same IP", () =>
    Effect.gen(function* () {
      const addedToPihole: DnsRecord[] = []

      const piholeLayer = makeMockPiholeClient({
        records: [makeTestRecord("existing.example.com", "192.168.1.1")],
        onAdd: (r) => addedToPihole.push(r)
      })

      const dnsProviderLayer = makeMockDnsProvider({ records: [] })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const record = makeTestRecord("existing.example.com", "192.168.1.1")
      const result = yield* manager.add(record)

      expect(result.pihole).toBe("success")
      // Should NOT have added (already exists)
      expect(addedToPihole).toHaveLength(0)
    })
  )
})

// ============================================================================
// Remove Operation Tests
// ============================================================================

describe("DomainManager.remove", () => {
  it.effect("removes from both providers successfully", () =>
    Effect.gen(function* () {
      const removedFromPihole: DnsRecord[] = []
      const removedFromProvider: Domain[] = []

      const existingRecord = makeTestRecord("remove-me.example.com", "192.168.1.1")

      const piholeLayer = makeMockPiholeClient({
        records: [existingRecord],
        onRemove: (r) => removedFromPihole.push(r)
      })

      const dnsProviderLayer = makeMockDnsProvider({
        records: [makeTestProviderRecord("remove-me.example.com", "192.168.1.1", "cf-1")],
        onRemove: (d) => removedFromProvider.push(d)
      })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const result = yield* manager.remove("remove-me.example.com" as Domain)

      expect(result.domain).toBe("remove-me.example.com")
      expect(result.pihole).toBe("success")
      expect(result.dnsProvider).toBe("success")

      expect(removedFromPihole).toHaveLength(1)
      expect(removedFromProvider).toHaveLength(1)
    })
  )

  it.effect("skips Pi-hole when record not found there", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({
        records: [] // No records in Pi-hole
      })

      const dnsProviderLayer = makeMockDnsProvider({
        records: [makeTestProviderRecord("only-in-cf.example.com", "1.2.3.4", "cf-1")]
      })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const result = yield* manager.remove("only-in-cf.example.com" as Domain)

      expect(result.pihole).toBe("skipped")
      expect(result.dnsProvider).toBe("success")
    })
  )

  it.effect("reports DNS provider failure", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({ records: [] })

      const dnsProviderLayer = makeMockDnsProvider({
        records: [],
        error: new DnsProviderError({
          provider: "test",
          message: "Delete failed"
        })
      })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const result = yield* manager.remove("test.example.com" as Domain)

      expect(result.dnsProvider).toBe("failed")
      expect(result.dnsProviderError).toBeDefined()
    })
  )
})

// ============================================================================
// Sync Operation Tests
// ============================================================================

describe("DomainManager.sync", () => {
  it.effect("syncs all Pi-hole records to DNS provider", () =>
    Effect.gen(function* () {
      const upsertedRecords: DnsRecord[] = []

      const piholeLayer = makeMockPiholeClient({
        records: [
          makeTestRecord("a.example.com", "192.168.1.1"),
          makeTestRecord("b.example.com", "192.168.1.2"),
          makeTestRecord("c.example.com", "192.168.1.3")
        ]
      })

      const dnsProviderLayer = makeMockDnsProvider({
        records: [],
        onUpsert: (r) => upsertedRecords.push(r)
      })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const results = yield* manager.sync()

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.pihole === "success")).toBe(true)
      expect(results.every((r) => r.dnsProvider === "success")).toBe(true)

      expect(upsertedRecords).toHaveLength(3)
    })
  )

  it.effect("reports per-record DNS provider failures", () =>
    Effect.gen(function* () {
      let upsertCount = 0

      const piholeLayer = makeMockPiholeClient({
        records: [
          makeTestRecord("a.example.com", "1.1.1.1"),
          makeTestRecord("b.example.com", "2.2.2.2")
        ]
      })

      // Fail on second upsert
      const dnsProviderLayer = Layer.effect(
        DnsProvider,
        Effect.succeed(DnsProvider.of({
          name: "failing-provider",
          list: () => Effect.succeed([]),
          find: () => Effect.succeed(null as any),
          add: () => Effect.succeed(null as any),
          remove: () => Effect.succeed(undefined),
          upsert: (record) => {
            upsertCount++
            if (upsertCount === 2) {
              return Effect.fail(new DnsProviderError({
                provider: "test",
                message: "Second record failed"
              }))
            }
            return Effect.succeed(makeTestProviderRecord(record.domain, record.ip, `mock-${upsertCount}`))
          }
        }))
      )

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const results = yield* manager.sync()

      expect(results).toHaveLength(2)
      expect(results[0].dnsProvider).toBe("success")
      expect(results[1].dnsProvider).toBe("failed")
      expect(results[1].dnsProviderError).toBeDefined()
    })
  )

  it.effect("fails completely when Pi-hole list fails", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({
        error: new PiholeApiError({ message: "Cannot list records" })
      })

      const dnsProviderLayer = makeMockDnsProvider({ records: [] })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const result = yield* manager.sync().pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
  )

  it.effect("returns empty results when Pi-hole has no records", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({ records: [] })
      const dnsProviderLayer = makeMockDnsProvider({ records: [] })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const results = yield* manager.sync()

      expect(results).toEqual([])
    })
  )

  it.effect("removes stale DNS provider records not in Pi-hole", () =>
    Effect.gen(function* () {
      const removedDomains: Domain[] = []

      const piholeLayer = makeMockPiholeClient({
        records: [
          makeTestRecord("shared.example.com", "192.168.1.1")
        ]
      })

      const dnsProviderLayer = makeMockDnsProvider({
        records: [
          makeTestProviderRecord("shared.example.com", "192.168.1.1", "cf-1"),
          makeTestProviderRecord("stale.example.com", "192.168.1.99", "cf-2")
        ],
        onRemove: (d) => removedDomains.push(d)
      })

      const testLayer = Layer.provideMerge(
        DomainManager.layer,
        Layer.merge(piholeLayer, dnsProviderLayer)
      )

      const manager = yield* DomainManager.pipe(Effect.provide(testLayer))
      const results = yield* manager.sync()

      // Should have 2 results: 1 upsert + 1 removal
      expect(results).toHaveLength(2)

      const upsertResult = results.find((r) => r.domain === "shared.example.com")
      expect(upsertResult?.pihole).toBe("success")
      expect(upsertResult?.dnsProvider).toBe("success")

      const removeResult = results.find((r) => r.domain === "stale.example.com")
      expect(removeResult?.pihole).toBe("skipped")
      expect(removeResult?.dnsProvider).toBe("success")

      expect(removedDomains).toHaveLength(1)
      expect(removedDomains[0]).toBe("stale.example.com")
    })
  )
})

// ============================================================================
// ManagedDnsRecord Schema Tests
// ============================================================================

describe("ManagedDnsRecord", () => {
  it.effect("creates record with all status flags", () =>
    Effect.gen(function* () {
      const record = ManagedDnsRecord.make({
        domain: "test.example.com",
        ip: "192.168.1.1",
        inPihole: true,
        inDnsProvider: true,
        dnsRecordId: "cf-123"
      })

      expect(record.domain).toBe("test.example.com")
      expect(record.ip).toBe("192.168.1.1")
      expect(record.inPihole).toBe(true)
      expect(record.inDnsProvider).toBe(true)
      expect(record.dnsRecordId).toBe("cf-123")
    })
  )

  it.effect("dnsRecordId is optional", () =>
    Effect.gen(function* () {
      const record = ManagedDnsRecord.make({
        domain: "test.example.com",
        ip: "192.168.1.1",
        inPihole: true,
        inDnsProvider: false
      })

      expect(record.dnsRecordId).toBeUndefined()
    })
  )
})
