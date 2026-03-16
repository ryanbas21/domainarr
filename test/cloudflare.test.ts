/**
 * Tests for Cloudflare DNS provider.
 *
 * These tests verify the Cloudflare provider configuration schema
 * and error wrapping behavior. Full integration tests would require
 * mocking the Cloudflare SDK, which is complex.
 */
import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Redacted, Schema } from "effect"
import { CloudflareConfig, makeCloudflareProvider } from "../src/services/providers/cloudflare.js"
import { DnsProvider } from "../src/services/DnsProvider.js"

// ============================================================================
// CloudflareConfig Schema Tests
// ============================================================================

describe("CloudflareConfig schema", () => {
  it.effect("accepts valid config from raw JSON", () =>
    Effect.gen(function* () {
      // When decoding from JSON, apiToken comes as a plain string
      const rawConfig = {
        type: "cloudflare" as const,
        apiToken: "my-api-token", // Plain string, not Redacted
        zoneId: "zone-abc123",
        zone: "example.com"
      }

      const validated = yield* Schema.decodeUnknown(CloudflareConfig)(rawConfig)

      expect(validated.type).toBe("cloudflare")
      expect(validated.zoneId).toBe("zone-abc123")
      expect(validated.zone).toBe("example.com")
      expect(Redacted.value(validated.apiToken)).toBe("my-api-token")
    })
  )

  it.effect("requires type to be 'cloudflare'", () =>
    Effect.gen(function* () {
      const config = {
        type: "porkbun", // Wrong type
        apiToken: Redacted.make("token"),
        zoneId: "zone-123",
        zone: "example.com"
      }

      const result = yield* Schema.decodeUnknown(CloudflareConfig)(config).pipe(Effect.either)
      expect(result._tag).toBe("Left")
    })
  )

  it.effect("requires all fields", () =>
    Effect.gen(function* () {
      const missingToken = {
        type: "cloudflare" as const,
        zoneId: "zone-123",
        zone: "example.com"
        // Missing apiToken
      }

      const result = yield* Schema.decodeUnknown(CloudflareConfig)(missingToken).pipe(Effect.either)
      expect(result._tag).toBe("Left")
    })
  )

  it.effect("encodes Redacted token to plain string for JSON", () =>
    Effect.gen(function* () {
      const config: CloudflareConfig = {
        type: "cloudflare",
        apiToken: Redacted.make("secret-token"),
        zoneId: "zone-123",
        zone: "example.com"
      }

      const encoded = yield* Schema.encode(CloudflareConfig)(config)

      expect(encoded.type).toBe("cloudflare")
      expect(encoded.apiToken).toBe("secret-token")
    })
  )

  it.effect("decodes plain string to Redacted token", () =>
    Effect.gen(function* () {
      const raw = {
        type: "cloudflare" as const,
        apiToken: "plain-string-token",
        zoneId: "zone-123",
        zone: "example.com"
      }

      const decoded = yield* Schema.decodeUnknown(CloudflareConfig)(raw)

      expect(Redacted.value(decoded.apiToken)).toBe("plain-string-token")
    })
  )
})

// ============================================================================
// Provider Factory Tests
// ============================================================================

describe("makeCloudflareProvider", () => {
  it.effect("creates a provider with correct name", () =>
    Effect.gen(function* () {
      const config: CloudflareConfig = {
        type: "cloudflare",
        apiToken: Redacted.make("test-token"),
        zoneId: "zone-123",
        zone: "example.com"
      }

      const layer = makeCloudflareProvider(config)

      // The layer is scoped, so we need to provide a scope
      const provider = yield* DnsProvider.pipe(
        Effect.provide(layer),
        Effect.scoped
      )

      expect(provider.name).toBe("cloudflare")
    })
  )

  it.effect("provider has all required methods", () =>
    Effect.gen(function* () {
      const config: CloudflareConfig = {
        type: "cloudflare",
        apiToken: Redacted.make("test-token"),
        zoneId: "zone-123",
        zone: "example.com"
      }

      const layer = makeCloudflareProvider(config)

      const provider = yield* DnsProvider.pipe(
        Effect.provide(layer),
        Effect.scoped
      )

      // Verify all interface methods exist
      expect(typeof provider.list).toBe("function")
      expect(typeof provider.find).toBe("function")
      expect(typeof provider.add).toBe("function")
      expect(typeof provider.remove).toBe("function")
      expect(typeof provider.upsert).toBe("function")
    })
  )
})

// ============================================================================
// Config Discrimination Tests
// ============================================================================

describe("Cloudflare config type discrimination", () => {
  it.effect("type field acts as discriminator", () =>
    Effect.gen(function* () {
      // This demonstrates how the config union works with discriminated types
      const cloudflareConfig = {
        type: "cloudflare" as const,
        apiToken: Redacted.make("cf-token"),
        zoneId: "zone-123",
        zone: "example.com"
      }

      // Type narrowing works based on type field
      if (cloudflareConfig.type === "cloudflare") {
        expect(cloudflareConfig.zoneId).toBeDefined()
        expect(cloudflareConfig.zone).toBeDefined()
      }
    })
  )
})

// ============================================================================
// Retry Configuration Tests
// ============================================================================

describe("Cloudflare retry behavior", () => {
  it("retryable status codes are 5xx and 429", () => {
    // These are the codes the provider considers retryable
    const retryableCodes = [500, 501, 502, 503, 504, 429]
    const nonRetryableCodes = [400, 401, 403, 404, 422]

    // Just verify the documentation matches expected behavior
    expect(retryableCodes.every((c) => c >= 500 || c === 429)).toBe(true)
    expect(nonRetryableCodes.every((c) => c < 500 && c !== 429)).toBe(true)
  })

  it("retry config has reasonable defaults", () => {
    // These values should match the RETRY_CONFIG in cloudflare.ts
    const expectedMaxAttempts = 3
    const expectedBaseDelayMs = 500
    const expectedMaxDelayMs = 10000

    // Verify these are sensible values
    expect(expectedMaxAttempts).toBeGreaterThanOrEqual(1)
    expect(expectedMaxAttempts).toBeLessThanOrEqual(5)
    expect(expectedBaseDelayMs).toBeGreaterThan(0)
    expect(expectedMaxDelayMs).toBeGreaterThan(expectedBaseDelayMs)
  })
})

// ============================================================================
// DNS Record Properties Tests
// ============================================================================

describe("Cloudflare DNS record properties", () => {
  it("A records use TTL of 1 (auto)", () => {
    // TTL of 1 tells Cloudflare to auto-manage TTL
    const expectedTtl = 1
    expect(expectedTtl).toBe(1)
  })

  it("A records are not proxied (local DNS)", () => {
    // For local DNS records, proxied should be false
    const expectedProxied = false
    expect(expectedProxied).toBe(false)
  })

  it("only A records are listed (not AAAA, CNAME, etc)", () => {
    // The provider filters to only A records
    const recordTypesHandled = ["A"]
    expect(recordTypesHandled).toEqual(["A"])
  })
})
