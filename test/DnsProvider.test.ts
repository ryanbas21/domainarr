/**
 * Tests for DnsProvider interface and mock implementation.
 *
 * These tests verify the DnsProvider interface contract using
 * the mock implementation from helpers.ts.
 */
import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import {
  DnsProvider,
  DnsProviderError,
  DnsProviderAuthError,
  DnsProviderRecordNotFoundError
} from "../src/services/DnsProvider.js"
import { DnsRecord, type Domain, type IpAddress, ProviderDnsRecord } from "../src/domain/DnsRecord.js"
import { makeMockDnsProvider, makeTestRecord, makeTestProviderRecord } from "./helpers.js"

// ============================================================================
// Provider Interface Contract Tests
// ============================================================================

describe("DnsProvider interface", () => {
  it.effect("list returns all records", () =>
    Effect.gen(function* () {
      const records = [
        makeTestProviderRecord("a.example.com", "192.168.1.1", "id-1"),
        makeTestProviderRecord("b.example.com", "192.168.1.2", "id-2")
      ]

      const layer = makeMockDnsProvider({ records })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))
      const result = yield* provider.list()

      expect(result).toHaveLength(2)
      expect(result[0].domain).toBe("a.example.com")
      expect(result[1].domain).toBe("b.example.com")
    })
  )

  it.effect("list returns empty array when no records", () =>
    Effect.gen(function* () {
      const layer = makeMockDnsProvider({ records: [] })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))
      const result = yield* provider.list()

      expect(result).toEqual([])
    })
  )

  it.effect("find returns Some when record exists", () =>
    Effect.gen(function* () {
      const records = [
        makeTestProviderRecord("target.example.com", "10.0.0.1", "target-id")
      ]

      const layer = makeMockDnsProvider({ records })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))
      const result = yield* provider.find("target.example.com" as Domain)

      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.domain).toBe("target.example.com")
        expect(result.value.recordId).toBe("target-id")
      }
    })
  )

  it.effect("find returns None when record does not exist", () =>
    Effect.gen(function* () {
      const records = [
        makeTestProviderRecord("other.example.com", "10.0.0.1", "other-id")
      ]

      const layer = makeMockDnsProvider({ records })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))
      const result = yield* provider.find("missing.example.com" as Domain)

      expect(Option.isNone(result)).toBe(true)
    })
  )

  it.effect("add creates new record with generated ID", () =>
    Effect.gen(function* () {
      const layer = makeMockDnsProvider({ records: [] })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))

      const newRecord = makeTestRecord("new.example.com", "192.168.1.50")
      const created = yield* provider.add(newRecord)

      expect(created.domain).toBe("new.example.com")
      expect(created.ip).toBe("192.168.1.50")
      expect(created.recordId).toBeDefined()
      expect(created.recordId.startsWith("mock-")).toBe(true)

      // Verify it appears in list
      const all = yield* provider.list()
      expect(all).toHaveLength(1)
    })
  )

  it.effect("remove deletes existing record", () =>
    Effect.gen(function* () {
      const records = [
        makeTestProviderRecord("delete-me.example.com", "10.0.0.1", "del-id"),
        makeTestProviderRecord("keep-me.example.com", "10.0.0.2", "keep-id")
      ]

      const layer = makeMockDnsProvider({ records })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))

      yield* provider.remove("delete-me.example.com" as Domain)

      const remaining = yield* provider.list()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].domain).toBe("keep-me.example.com")
    })
  )

  it.effect("upsert creates record if not exists", () =>
    Effect.gen(function* () {
      const layer = makeMockDnsProvider({ records: [] })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))

      const record = makeTestRecord("new.example.com", "1.2.3.4")
      const result = yield* provider.upsert(record)

      expect(result.domain).toBe("new.example.com")
      expect(result.ip).toBe("1.2.3.4")

      const all = yield* provider.list()
      expect(all).toHaveLength(1)
    })
  )

  it.effect("upsert updates existing record IP", () =>
    Effect.gen(function* () {
      const records = [
        makeTestProviderRecord("update-me.example.com", "192.168.1.1", "update-id")
      ]

      const layer = makeMockDnsProvider({ records })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))

      const updatedRecord = makeTestRecord("update-me.example.com", "192.168.1.100")
      const result = yield* provider.upsert(updatedRecord)

      expect(result.domain).toBe("update-me.example.com")
      expect(result.ip).toBe("192.168.1.100")
      expect(result.recordId).toBe("update-id") // Should keep same ID

      const all = yield* provider.list()
      expect(all).toHaveLength(1)
      expect(all[0].ip).toBe("192.168.1.100")
    })
  )

  it.effect("provider has name property", () =>
    Effect.gen(function* () {
      const layer = makeMockDnsProvider({ name: "test-provider" })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))

      expect(provider.name).toBe("test-provider")
    })
  )
})

// ============================================================================
// Error Propagation Tests
// ============================================================================

describe("DnsProvider error handling", () => {
  it.effect("list propagates errors", () =>
    Effect.gen(function* () {
      const error = new DnsProviderError({
        provider: "test",
        message: "API error",
        code: 500
      })

      const layer = makeMockDnsProvider({ error })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))
      const result = yield* provider.list().pipe(Effect.either)

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("DnsProviderError")
      }
    })
  )

  it.effect("find propagates errors", () =>
    Effect.gen(function* () {
      const error = new DnsProviderAuthError({
        provider: "test",
        message: "Invalid token"
      })

      const layer = makeMockDnsProvider({ error })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))
      const result = yield* provider.find("any.domain" as Domain).pipe(Effect.either)

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("DnsProviderAuthError")
      }
    })
  )

  it.effect("add propagates errors", () =>
    Effect.gen(function* () {
      const error = new DnsProviderError({
        provider: "test",
        message: "Rate limited",
        code: 429
      })

      const layer = makeMockDnsProvider({ error })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))
      const result = yield* provider.add(makeTestRecord("a.com", "1.1.1.1")).pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
  )

  it.effect("remove propagates errors", () =>
    Effect.gen(function* () {
      const error = new DnsProviderError({
        provider: "test",
        message: "Server error",
        code: 500
      })

      const layer = makeMockDnsProvider({ error })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))
      const result = yield* provider.remove("a.com" as Domain).pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
  )

  it.effect("upsert propagates errors", () =>
    Effect.gen(function* () {
      const error = new DnsProviderRecordNotFoundError({
        provider: "test",
        domain: "missing.com"
      })

      const layer = makeMockDnsProvider({ error })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))
      const result = yield* provider.upsert(makeTestRecord("a.com", "1.1.1.1")).pipe(Effect.either)

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("DnsProviderRecordNotFoundError")
      }
    })
  )
})

// ============================================================================
// Callback Tests
// ============================================================================

describe("DnsProvider callbacks", () => {
  it.effect("onAdd callback is invoked", () =>
    Effect.gen(function* () {
      const addedRecords: DnsRecord[] = []

      const layer = makeMockDnsProvider({
        records: [],
        onAdd: (record) => addedRecords.push(record)
      })

      const provider = yield* DnsProvider.pipe(Effect.provide(layer))

      yield* provider.add(makeTestRecord("a.com", "1.1.1.1"))
      yield* provider.add(makeTestRecord("b.com", "2.2.2.2"))

      expect(addedRecords).toHaveLength(2)
      expect(addedRecords[0].domain).toBe("a.com")
      expect(addedRecords[1].domain).toBe("b.com")
    })
  )

  it.effect("onRemove callback is invoked", () =>
    Effect.gen(function* () {
      const removedDomains: Domain[] = []

      const layer = makeMockDnsProvider({
        records: [
          makeTestProviderRecord("a.com", "1.1.1.1", "id-a"),
          makeTestProviderRecord("b.com", "2.2.2.2", "id-b")
        ],
        onRemove: (domain) => removedDomains.push(domain)
      })

      const provider = yield* DnsProvider.pipe(Effect.provide(layer))

      yield* provider.remove("a.com" as Domain)

      expect(removedDomains).toHaveLength(1)
      expect(removedDomains[0]).toBe("a.com")
    })
  )

  it.effect("onUpsert callback is invoked for both create and update", () =>
    Effect.gen(function* () {
      const upsertedRecords: DnsRecord[] = []

      const layer = makeMockDnsProvider({
        records: [makeTestProviderRecord("existing.com", "1.1.1.1", "existing-id")],
        onUpsert: (record) => upsertedRecords.push(record)
      })

      const provider = yield* DnsProvider.pipe(Effect.provide(layer))

      // Update existing
      yield* provider.upsert(makeTestRecord("existing.com", "1.1.1.2"))
      // Create new
      yield* provider.upsert(makeTestRecord("new.com", "2.2.2.2"))

      expect(upsertedRecords).toHaveLength(2)
      expect(upsertedRecords[0].domain).toBe("existing.com")
      expect(upsertedRecords[1].domain).toBe("new.com")
    })
  )
})

// ============================================================================
// State Management Tests
// ============================================================================

describe("DnsProvider state management", () => {
  it.effect("operations affect shared state within same provider instance", () =>
    Effect.gen(function* () {
      const layer = makeMockDnsProvider({ records: [] })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))

      // Add records
      yield* provider.add(makeTestRecord("a.com", "1.1.1.1"))
      yield* provider.add(makeTestRecord("b.com", "2.2.2.2"))

      // List should show both
      let all = yield* provider.list()
      expect(all).toHaveLength(2)

      // Remove one
      yield* provider.remove("a.com" as Domain)

      // List should show one
      all = yield* provider.list()
      expect(all).toHaveLength(1)
      expect(all[0].domain).toBe("b.com")

      // Upsert should update
      yield* provider.upsert(makeTestRecord("b.com", "3.3.3.3"))

      all = yield* provider.list()
      expect(all).toHaveLength(1)
      expect(all[0].ip).toBe("3.3.3.3")
    })
  )

  it.effect("record IDs are generated incrementally", () =>
    Effect.gen(function* () {
      const layer = makeMockDnsProvider({ records: [] })
      const provider = yield* DnsProvider.pipe(Effect.provide(layer))

      const r1 = yield* provider.add(makeTestRecord("a.com", "1.1.1.1"))
      const r2 = yield* provider.add(makeTestRecord("b.com", "2.2.2.2"))
      const r3 = yield* provider.add(makeTestRecord("c.com", "3.3.3.3"))

      // IDs should be mock-1, mock-2, mock-3
      expect(r1.recordId).toBe("mock-1")
      expect(r2.recordId).toBe("mock-2")
      expect(r3.recordId).toBe("mock-3")
    })
  )
})
