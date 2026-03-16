/**
 * Tests for domain models: DnsRecord, ProviderDnsRecord, DnsBackup
 * and their parsing/validation functions.
 */
import { describe, it, expect } from "@effect/vitest"
import { Effect, Either, Schema } from "effect"
import {
  DnsRecord,
  Domain,
  IpAddress,
  ProviderDnsRecord,
  DnsBackup,
  parseDnsRecord,
  parseProviderDnsRecord
} from "../src/domain/DnsRecord.js"

// ============================================================================
// Domain - Branded String Validation
// ============================================================================

describe("Domain", () => {
  it.effect("accepts valid domain names", () =>
    Effect.gen(function* () {
      const validDomains = [
        "example.com",
        "sub.example.com",
        "deep.sub.example.com",
        "test-domain.example.com",
        "a.co",
        "localhost",
        "my-app",
        "192-168-1-1.nip.io"
      ]

      for (const domain of validDomains) {
        const result = yield* Schema.decodeUnknown(Domain)(domain).pipe(Effect.either)
        expect(result._tag, `Expected "${domain}" to be valid`).toBe("Right")
      }
    })
  )

  it.effect("rejects invalid domain names", () =>
    Effect.gen(function* () {
      const invalidDomains = [
        "not a domain!",
        "domain with spaces.com",
        "-starts-with-dash.com",
        "ends-with-dash-.com",
        ".starts-with-dot.com",
        "has..double..dots.com",
        "",
        "   ",
        "domain@with@at.com"
      ]

      for (const domain of invalidDomains) {
        const result = yield* Schema.decodeUnknown(Domain)(domain).pipe(Effect.either)
        expect(result._tag, `Expected "${domain}" to be invalid`).toBe("Left")
      }
    })
  )

  it.effect("accepts very long but valid domain labels (max 63 chars)", () =>
    Effect.gen(function* () {
      const longLabel = "a".repeat(63)
      const validLongDomain = `${longLabel}.example.com`
      const result = yield* Schema.decodeUnknown(Domain)(validLongDomain).pipe(Effect.either)
      expect(result._tag).toBe("Right")
    })
  )
})

// ============================================================================
// IpAddress - IPv4 Validation
// ============================================================================

describe("IpAddress", () => {
  it.effect("accepts valid IPv4 addresses", () =>
    Effect.gen(function* () {
      const validIps = [
        "192.168.1.1",
        "10.0.0.1",
        "172.16.0.1",
        "255.255.255.255",
        "0.0.0.0",
        "1.2.3.4",
        "127.0.0.1"
      ]

      for (const ip of validIps) {
        const result = yield* Schema.decodeUnknown(IpAddress)(ip).pipe(Effect.either)
        expect(result._tag, `Expected "${ip}" to be valid`).toBe("Right")
      }
    })
  )

  it.effect("rejects invalid IPv4 addresses", () =>
    Effect.gen(function* () {
      const invalidIps = [
        "999.999.999.999",
        "256.1.1.1",
        "192.168.1.256",
        "192.168.1",
        "192.168.1.1.1",
        "not.an.ip.address",
        "192.168.1.1/24",
        "::1",
        "2001:db8::1",
        "",
        "   ",
        "192.168.1.-1"
      ]

      for (const ip of invalidIps) {
        const result = yield* Schema.decodeUnknown(IpAddress)(ip).pipe(Effect.either)
        expect(result._tag, `Expected "${ip}" to be invalid`).toBe("Left")
      }
    })
  )

  it.effect("rejects octet values over 255", () =>
    Effect.gen(function* () {
      // Test each octet position
      const overflowIps = [
        "256.0.0.0",
        "0.256.0.0",
        "0.0.256.0",
        "0.0.0.256",
        "999.0.0.0"
      ]

      for (const ip of overflowIps) {
        const result = yield* Schema.decodeUnknown(IpAddress)(ip).pipe(Effect.either)
        expect(result._tag, `Expected "${ip}" to be invalid (octet > 255)`).toBe("Left")
      }
    })
  )
})

// ============================================================================
// DnsRecord
// ============================================================================

describe("DnsRecord", () => {
  it.effect("creates a valid DNS record", () =>
    Effect.gen(function* () {
      const record = DnsRecord.make({
        domain: "test.example.com" as Domain,
        ip: "192.168.1.1" as IpAddress
      })

      expect(record.domain).toBe("test.example.com")
      expect(record.ip).toBe("192.168.1.1")
    })
  )

  it.effect("encodes for Pi-hole API correctly", () =>
    Effect.gen(function* () {
      const record = DnsRecord.make({
        domain: "test.example.com" as Domain,
        ip: "192.168.1.1" as IpAddress
      })

      // Pi-hole expects "IP domain" format, URL encoded
      expect(record.piholeEncoded).toBe(
        encodeURIComponent("192.168.1.1 test.example.com")
      )
    })
  )

  it.effect("handles special characters in domain for Pi-hole encoding", () =>
    Effect.gen(function* () {
      const record = DnsRecord.make({
        domain: "my-app.example.com" as Domain,
        ip: "10.0.0.1" as IpAddress
      })

      // The dash should not need encoding, but the space between IP and domain does
      const encoded = record.piholeEncoded
      expect(encoded).toContain("10.0.0.1")
      expect(encoded).toContain("my-app.example.com")
      expect(decodeURIComponent(encoded)).toBe("10.0.0.1 my-app.example.com")
    })
  )

  it.effect("is serializable via Schema", () =>
    Effect.gen(function* () {
      const record = DnsRecord.make({
        domain: "test.example.com" as Domain,
        ip: "192.168.1.1" as IpAddress
      })

      // Encode to JSON-compatible object
      const encoded = yield* Schema.encode(DnsRecord)(record)
      expect(encoded).toEqual({
        domain: "test.example.com",
        ip: "192.168.1.1"
      })

      // Decode back
      const decoded = yield* Schema.decode(DnsRecord)(encoded)
      expect(decoded.domain).toBe(record.domain)
      expect(decoded.ip).toBe(record.ip)
    })
  )
})

// ============================================================================
// ProviderDnsRecord
// ============================================================================

describe("ProviderDnsRecord", () => {
  it.effect("creates a provider record with recordId", () =>
    Effect.gen(function* () {
      const record = ProviderDnsRecord.make({
        domain: "test.example.com" as Domain,
        ip: "192.168.1.1" as IpAddress,
        recordId: "cf-abc123"
      })

      expect(record.domain).toBe("test.example.com")
      expect(record.ip).toBe("192.168.1.1")
      expect(record.recordId).toBe("cf-abc123")
    })
  )

  it.effect("is serializable via Schema", () =>
    Effect.gen(function* () {
      const record = ProviderDnsRecord.make({
        domain: "test.example.com" as Domain,
        ip: "192.168.1.1" as IpAddress,
        recordId: "cf-abc123"
      })

      const encoded = yield* Schema.encode(ProviderDnsRecord)(record)
      expect(encoded).toEqual({
        domain: "test.example.com",
        ip: "192.168.1.1",
        recordId: "cf-abc123"
      })

      const decoded = yield* Schema.decode(ProviderDnsRecord)(encoded)
      expect(decoded.recordId).toBe("cf-abc123")
    })
  )
})

// ============================================================================
// DnsBackup
// ============================================================================

describe("DnsBackup", () => {
  it.effect("creates an empty backup", () =>
    Effect.gen(function* () {
      const backup = DnsBackup.empty()

      expect(backup.version).toBe(1)
      expect(backup.pihole).toEqual([])
      expect(backup.dnsProvider).toEqual([])
      expect(backup.timestamp).toBeInstanceOf(Date)
    })
  )

  it.effect("creates a backup with records", () =>
    Effect.gen(function* () {
      const piholeRecord = DnsRecord.make({
        domain: "pihole.local" as Domain,
        ip: "192.168.1.1" as IpAddress
      })

      const providerRecord = ProviderDnsRecord.make({
        domain: "cloud.example.com" as Domain,
        ip: "192.168.1.2" as IpAddress,
        recordId: "cf-123"
      })

      const backup = DnsBackup.make({
        version: 1,
        timestamp: new Date("2024-01-15T10:00:00Z"),
        pihole: [piholeRecord],
        dnsProvider: [providerRecord]
      })

      expect(backup.version).toBe(1)
      expect(backup.pihole).toHaveLength(1)
      expect(backup.dnsProvider).toHaveLength(1)
      expect(backup.pihole[0].domain).toBe("pihole.local")
      expect(backup.dnsProvider[0].recordId).toBe("cf-123")
    })
  )

  it.effect("serializes and deserializes to/from JSON", () =>
    Effect.gen(function* () {
      const backup = DnsBackup.make({
        version: 1,
        timestamp: new Date("2024-01-15T10:00:00Z"),
        pihole: [
          DnsRecord.make({
            domain: "test.local" as Domain,
            ip: "192.168.1.1" as IpAddress
          })
        ],
        dnsProvider: []
      })

      // Encode to JSON string
      const json = yield* Schema.encode(DnsBackup.Json)(backup)
      expect(typeof json).toBe("string")

      // Parse and verify structure
      const parsed = JSON.parse(json)
      expect(parsed.version).toBe(1)
      expect(parsed.pihole).toHaveLength(1)

      // Decode back
      const decoded = yield* Schema.decode(DnsBackup.Json)(json)
      expect(decoded.version).toBe(1)
      expect(decoded.pihole[0].domain).toBe("test.local")
    })
  )

  it.effect("rejects invalid backup version", () =>
    Effect.gen(function* () {
      const invalidJson = JSON.stringify({
        version: 2, // Invalid - only version 1 supported
        timestamp: new Date().toISOString(),
        pihole: [],
        dnsProvider: []
      })

      const result = yield* Schema.decode(DnsBackup.Json)(invalidJson).pipe(Effect.either)
      expect(result._tag).toBe("Left")
    })
  )

  it.effect("rejects backup with invalid records", () =>
    Effect.gen(function* () {
      const invalidJson = JSON.stringify({
        version: 1,
        timestamp: new Date().toISOString(),
        pihole: [
          { domain: "invalid domain!", ip: "not-an-ip" } // Both invalid
        ],
        dnsProvider: []
      })

      const result = yield* Schema.decode(DnsBackup.Json)(invalidJson).pipe(Effect.either)
      expect(result._tag).toBe("Left")
    })
  )
})

// ============================================================================
// parseDnsRecord
// ============================================================================

describe("parseDnsRecord", () => {
  it.effect("parses valid domain and IP", () =>
    Effect.gen(function* () {
      const record = yield* parseDnsRecord("test.example.com", "192.168.1.1")

      expect(record.domain).toBe("test.example.com")
      expect(record.ip).toBe("192.168.1.1")
    })
  )

  it.effect("fails on invalid domain", () =>
    Effect.gen(function* () {
      const result = yield* parseDnsRecord("invalid domain!", "192.168.1.1").pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
  )

  it.effect("fails on invalid IP", () =>
    Effect.gen(function* () {
      const result = yield* parseDnsRecord("test.example.com", "999.999.999.999").pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
  )

  it.effect("fails when both domain and IP are invalid", () =>
    Effect.gen(function* () {
      const result = yield* parseDnsRecord("not valid!", "not-an-ip").pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
  )
})

// ============================================================================
// parseProviderDnsRecord
// ============================================================================

describe("parseProviderDnsRecord", () => {
  it.effect("parses valid domain, IP, and recordId", () =>
    Effect.gen(function* () {
      const record = yield* parseProviderDnsRecord(
        "test.example.com",
        "192.168.1.1",
        "cf-record-123"
      )

      expect(record.domain).toBe("test.example.com")
      expect(record.ip).toBe("192.168.1.1")
      expect(record.recordId).toBe("cf-record-123")
    })
  )

  it.effect("fails on invalid domain", () =>
    Effect.gen(function* () {
      const result = yield* parseProviderDnsRecord(
        "invalid!",
        "192.168.1.1",
        "cf-123"
      ).pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
  )

  it.effect("fails on invalid IP", () =>
    Effect.gen(function* () {
      const result = yield* parseProviderDnsRecord(
        "test.example.com",
        "bad-ip",
        "cf-123"
      ).pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
  )

  it.effect("accepts any string for recordId (provider-specific)", () =>
    Effect.gen(function* () {
      // recordId format varies by provider, so we accept any string
      const record = yield* parseProviderDnsRecord(
        "test.example.com",
        "192.168.1.1",
        "very-long-provider-specific-id-12345"
      )

      expect(record.recordId).toBe("very-long-provider-specific-id-12345")
    })
  )
})
