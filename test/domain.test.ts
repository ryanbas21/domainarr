import { describe, it, expect } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { DnsRecord, Domain, IpAddress } from "../src/domain/DnsRecord.js"

describe("DnsRecord", () => {
  it.effect("creates a valid DNS record", () =>
    Effect.gen(function* () {
      const record = new DnsRecord({
        domain: "test.example.com" as Domain,
        ip: "192.168.1.1" as IpAddress
      })

      expect(record.domain).toBe("test.example.com")
      expect(record.ip).toBe("192.168.1.1")
    })
  )

  it.effect("encodes for Pi-hole API", () =>
    Effect.gen(function* () {
      const record = new DnsRecord({
        domain: "test.example.com" as Domain,
        ip: "192.168.1.1" as IpAddress
      })

      expect(record.piholeEncoded).toBe(
        encodeURIComponent("192.168.1.1 test.example.com")
      )
    })
  )

  it.effect("validates domain format", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(Domain)("valid.domain.com").pipe(
        Effect.either
      )

      expect(result._tag).toBe("Right")
    })
  )

  it.effect("rejects invalid domain", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(Domain)("not a domain!").pipe(
        Effect.either
      )

      expect(result._tag).toBe("Left")
    })
  )

  it.effect("validates IP address format", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(IpAddress)("192.168.1.1").pipe(
        Effect.either
      )

      expect(result._tag).toBe("Right")
    })
  )

  it.effect("rejects invalid IP address", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(IpAddress)("999.999.999.999").pipe(
        Effect.either
      )

      expect(result._tag).toBe("Left")
    })
  )
})
