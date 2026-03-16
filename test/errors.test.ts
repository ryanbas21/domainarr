/**
 * Tests for domain error types.
 *
 * All errors use Schema.TaggedError which provides:
 * - Type-safe error discrimination via _tag
 * - Serialization support
 * - Integration with Effect error handling
 */
import { describe, it, expect } from "@effect/vitest"
import { Effect, Schema } from "effect"
import {
  PiholeAuthError,
  PiholeApiError,
  PiholeConnectionError,
  PiholeError,
  ConfigNotFoundError,
  ConfigParseError,
  ConfigWriteError,
  ConfigError,
  BackupWriteError,
  BackupReadError,
  BackupError
} from "../src/domain/errors.js"
import {
  DnsProviderError,
  DnsProviderAuthError,
  DnsProviderRecordNotFoundError
} from "../src/services/DnsProvider.js"

// ============================================================================
// Pi-hole Errors
// ============================================================================

describe("PiholeAuthError", () => {
  it.effect("has correct _tag", () =>
    Effect.gen(function* () {
      const error = new PiholeAuthError({ message: "Invalid password" })
      expect(error._tag).toBe("PiholeAuthError")
    })
  )

  it.effect("stores message", () =>
    Effect.gen(function* () {
      const error = new PiholeAuthError({ message: "Session expired" })
      expect(error.message).toBe("Session expired")
    })
  )

  it.effect("can be caught by tag", () =>
    Effect.gen(function* () {
      const program = Effect.fail(new PiholeAuthError({ message: "test" })).pipe(
        Effect.catchTag("PiholeAuthError", (e) => Effect.succeed(`caught: ${e.message}`))
      )
      const result = yield* program
      expect(result).toBe("caught: test")
    })
  )
})

describe("PiholeApiError", () => {
  it.effect("has correct _tag", () =>
    Effect.gen(function* () {
      const error = new PiholeApiError({ message: "Not found" })
      expect(error._tag).toBe("PiholeApiError")
    })
  )

  it.effect("stores message and optional status", () =>
    Effect.gen(function* () {
      const error = new PiholeApiError({ message: "Server error", status: 500 })
      expect(error.message).toBe("Server error")
      expect(error.status).toBe(500)
    })
  )

  it.effect("allows status to be undefined", () =>
    Effect.gen(function* () {
      const error = new PiholeApiError({ message: "Unknown error" })
      expect(error.status).toBeUndefined()
    })
  )
})

describe("PiholeConnectionError", () => {
  it.effect("has correct _tag", () =>
    Effect.gen(function* () {
      const error = new PiholeConnectionError({
        message: "Connection refused",
        url: "http://pihole.local"
      })
      expect(error._tag).toBe("PiholeConnectionError")
    })
  )

  it.effect("stores message and url", () =>
    Effect.gen(function* () {
      const error = new PiholeConnectionError({
        message: "Timeout",
        url: "http://192.168.1.1"
      })
      expect(error.message).toBe("Timeout")
      expect(error.url).toBe("http://192.168.1.1")
    })
  )
})

describe("PiholeError union", () => {
  it.effect("decodes PiholeAuthError", () =>
    Effect.gen(function* () {
      const error = new PiholeAuthError({ message: "test" })
      const encoded = yield* Schema.encode(PiholeError)(error)
      const decoded = yield* Schema.decode(PiholeError)(encoded)
      expect(decoded._tag).toBe("PiholeAuthError")
    })
  )

  it.effect("decodes PiholeApiError", () =>
    Effect.gen(function* () {
      const error = new PiholeApiError({ message: "test", status: 404 })
      const encoded = yield* Schema.encode(PiholeError)(error)
      const decoded = yield* Schema.decode(PiholeError)(encoded)
      expect(decoded._tag).toBe("PiholeApiError")
    })
  )

  it.effect("decodes PiholeConnectionError", () =>
    Effect.gen(function* () {
      const error = new PiholeConnectionError({ message: "test", url: "http://test" })
      const encoded = yield* Schema.encode(PiholeError)(error)
      const decoded = yield* Schema.decode(PiholeError)(encoded)
      expect(decoded._tag).toBe("PiholeConnectionError")
    })
  )
})

// ============================================================================
// Config Errors
// ============================================================================

describe("ConfigNotFoundError", () => {
  it.effect("has correct _tag", () =>
    Effect.gen(function* () {
      const error = new ConfigNotFoundError({ path: "/home/user/.config/domainarr/config.json" })
      expect(error._tag).toBe("ConfigNotFoundError")
    })
  )

  it.effect("stores path", () =>
    Effect.gen(function* () {
      const path = "/custom/path/config.json"
      const error = new ConfigNotFoundError({ path })
      expect(error.path).toBe(path)
    })
  )
})

describe("ConfigParseError", () => {
  it.effect("has correct _tag", () =>
    Effect.gen(function* () {
      const error = new ConfigParseError({ message: "Invalid JSON" })
      expect(error._tag).toBe("ConfigParseError")
    })
  )

  it.effect("stores message", () =>
    Effect.gen(function* () {
      const error = new ConfigParseError({ message: "Missing required field: pihole" })
      expect(error.message).toBe("Missing required field: pihole")
    })
  )
})

describe("ConfigWriteError", () => {
  it.effect("has correct _tag", () =>
    Effect.gen(function* () {
      const error = new ConfigWriteError({
        path: "/config.json",
        message: "Permission denied"
      })
      expect(error._tag).toBe("ConfigWriteError")
    })
  )

  it.effect("stores path and message", () =>
    Effect.gen(function* () {
      const error = new ConfigWriteError({
        path: "/etc/domainarr/config.json",
        message: "Read-only filesystem"
      })
      expect(error.path).toBe("/etc/domainarr/config.json")
      expect(error.message).toBe("Read-only filesystem")
    })
  )
})

describe("ConfigError union", () => {
  it.effect("can discriminate between error types", () =>
    Effect.gen(function* () {
      const notFound = new ConfigNotFoundError({ path: "/test" })
      const parse = new ConfigParseError({ message: "bad json" })
      const write = new ConfigWriteError({ path: "/test", message: "denied" })

      expect(notFound._tag).toBe("ConfigNotFoundError")
      expect(parse._tag).toBe("ConfigParseError")
      expect(write._tag).toBe("ConfigWriteError")
    })
  )
})

// ============================================================================
// Backup Errors
// ============================================================================

describe("BackupWriteError", () => {
  it.effect("has correct _tag", () =>
    Effect.gen(function* () {
      const error = new BackupWriteError({
        path: "/backups/backup.json",
        message: "Disk full"
      })
      expect(error._tag).toBe("BackupWriteError")
    })
  )

  it.effect("stores path and message", () =>
    Effect.gen(function* () {
      const error = new BackupWriteError({
        path: "/tmp/backup.json",
        message: "Write failed"
      })
      expect(error.path).toBe("/tmp/backup.json")
      expect(error.message).toBe("Write failed")
    })
  )
})

describe("BackupReadError", () => {
  it.effect("has correct _tag", () =>
    Effect.gen(function* () {
      const error = new BackupReadError({
        path: "/backups/missing.json",
        message: "File not found"
      })
      expect(error._tag).toBe("BackupReadError")
    })
  )

  it.effect("stores path and message", () =>
    Effect.gen(function* () {
      const error = new BackupReadError({
        path: "/corrupted.json",
        message: "Invalid JSON at position 42"
      })
      expect(error.path).toBe("/corrupted.json")
      expect(error.message).toBe("Invalid JSON at position 42")
    })
  )
})

describe("BackupError union", () => {
  it.effect("can discriminate between error types", () =>
    Effect.gen(function* () {
      const write = new BackupWriteError({ path: "/test", message: "write" })
      const read = new BackupReadError({ path: "/test", message: "read" })

      expect(write._tag).toBe("BackupWriteError")
      expect(read._tag).toBe("BackupReadError")
    })
  )
})

// ============================================================================
// DNS Provider Errors
// ============================================================================

describe("DnsProviderError", () => {
  it.effect("has correct _tag", () =>
    Effect.gen(function* () {
      const error = new DnsProviderError({
        provider: "cloudflare",
        message: "Rate limited"
      })
      expect(error._tag).toBe("DnsProviderError")
    })
  )

  it.effect("stores provider, message, and optional code", () =>
    Effect.gen(function* () {
      const error = new DnsProviderError({
        provider: "cloudflare",
        message: "Too many requests",
        code: 429
      })
      expect(error.provider).toBe("cloudflare")
      expect(error.message).toBe("Too many requests")
      expect(error.code).toBe(429)
    })
  )

  it.effect("allows code to be undefined", () =>
    Effect.gen(function* () {
      const error = new DnsProviderError({
        provider: "porkbun",
        message: "Unknown error"
      })
      expect(error.code).toBeUndefined()
    })
  )
})

describe("DnsProviderAuthError", () => {
  it.effect("has correct _tag", () =>
    Effect.gen(function* () {
      const error = new DnsProviderAuthError({
        provider: "cloudflare",
        message: "Invalid API token"
      })
      expect(error._tag).toBe("DnsProviderAuthError")
    })
  )

  it.effect("stores provider and message", () =>
    Effect.gen(function* () {
      const error = new DnsProviderAuthError({
        provider: "porkbun",
        message: "API key expired"
      })
      expect(error.provider).toBe("porkbun")
      expect(error.message).toBe("API key expired")
    })
  )
})

describe("DnsProviderRecordNotFoundError", () => {
  it.effect("has correct _tag", () =>
    Effect.gen(function* () {
      const error = new DnsProviderRecordNotFoundError({
        provider: "cloudflare",
        domain: "missing.example.com"
      })
      expect(error._tag).toBe("DnsProviderRecordNotFoundError")
    })
  )

  it.effect("stores provider and domain", () =>
    Effect.gen(function* () {
      const error = new DnsProviderRecordNotFoundError({
        provider: "cloudflare",
        domain: "test.example.com"
      })
      expect(error.provider).toBe("cloudflare")
      expect(error.domain).toBe("test.example.com")
    })
  )

  it.effect("generates message from domain", () =>
    Effect.gen(function* () {
      const error = new DnsProviderRecordNotFoundError({
        provider: "cloudflare",
        domain: "missing.example.com"
      })
      expect(error.message).toBe("Record not found: missing.example.com")
    })
  )
})

// ============================================================================
// Error Handling Patterns
// ============================================================================

describe("Error handling patterns", () => {
  it.effect("catchTag works with specific error types", () =>
    Effect.gen(function* () {
      const program = Effect.fail(new PiholeApiError({ message: "test", status: 500 })).pipe(
        Effect.catchTag("PiholeApiError", (e) => Effect.succeed(`API error: ${e.status}`)),
        Effect.catchTag("PiholeAuthError", () => Effect.succeed("Auth error")),
        Effect.catchTag("PiholeConnectionError", () => Effect.succeed("Connection error"))
      )

      const result = yield* program
      expect(result).toBe("API error: 500")
    })
  )

  it.effect("catchTags works with multiple error types", () =>
    Effect.gen(function* () {
      const program = Effect.fail(new ConfigParseError({ message: "bad json" })).pipe(
        Effect.catchTags({
          ConfigNotFoundError: () => Effect.succeed("not found"),
          ConfigParseError: (e) => Effect.succeed(`parse: ${e.message}`),
          ConfigWriteError: () => Effect.succeed("write error")
        })
      )

      const result = yield* program
      expect(result).toBe("parse: bad json")
    })
  )

  it.effect("errors are instanceof Error", () =>
    Effect.gen(function* () {
      const errors = [
        new PiholeAuthError({ message: "test" }),
        new PiholeApiError({ message: "test" }),
        new ConfigNotFoundError({ path: "/test" }),
        new BackupWriteError({ path: "/test", message: "test" }),
        new DnsProviderError({ provider: "test", message: "test" })
      ]

      for (const error of errors) {
        expect(error).toBeInstanceOf(Error)
      }
    })
  )
})
