/**
 * Tests for AppConfig service.
 *
 * Tests config loading, validation, and the writeConfig function
 * using an in-memory file system mock.
 */
import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Ref, Redacted, Schema } from "effect"
import { FileSystem } from "@effect/platform"
import { AppConfig, type DnsProviderConfig } from "../src/config/AppConfig.js"
import { ConfigNotFoundError, ConfigParseError } from "../src/domain/errors.js"

// ============================================================================
// Mock FileSystem
// ============================================================================

interface MockFile {
  content: string
  isDirectory: boolean
}

const makeMockFileSystem = (initialFiles: Record<string, MockFile> = {}) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const filesRef = yield* Ref.make<Record<string, MockFile>>(initialFiles)

      return FileSystem.FileSystem.of({
        exists: (path) =>
          Ref.get(filesRef).pipe(
            Effect.map((files) => path in files)
          ),

        readFileString: (path) =>
          Ref.get(filesRef).pipe(
            Effect.flatMap((files) => {
              const file = files[path]
              if (!file) {
                return Effect.fail({ _tag: "SystemError", reason: "NotFound", path } as any)
              }
              if (file.isDirectory) {
                return Effect.fail({ _tag: "SystemError", reason: "NotAFile", path } as any)
              }
              return Effect.succeed(file.content)
            })
          ),

        writeFileString: (path, content) =>
          Ref.update(filesRef, (files) => ({
            ...files,
            [path]: { content, isDirectory: false }
          })),

        makeDirectory: (path, _options) =>
          Ref.update(filesRef, (files) => ({
            ...files,
            [path]: { content: "", isDirectory: true }
          })),

        readDirectory: (path) =>
          Ref.get(filesRef).pipe(
            Effect.map((files) => {
              const entries: string[] = []
              for (const filePath of Object.keys(files)) {
                if (filePath.startsWith(path + "/") && !filePath.slice(path.length + 1).includes("/")) {
                  entries.push(filePath.slice(path.length + 1))
                }
              }
              return entries
            })
          ),

        // Stub implementations
        access: () => Effect.void,
        copy: () => Effect.void,
        copyFile: () => Effect.void,
        chmod: () => Effect.void,
        chown: () => Effect.void,
        link: () => Effect.void,
        makeDirectoryScoped: () => Effect.void as any,
        makeTempDirectory: () => Effect.succeed("/tmp/mock"),
        makeTempDirectoryScoped: () => Effect.succeed("/tmp/mock"),
        makeTempFile: () => Effect.succeed("/tmp/mock-file"),
        makeTempFileScoped: () => Effect.succeed("/tmp/mock-file"),
        open: () => Effect.succeed({} as any),
        readFile: () => Effect.succeed(new Uint8Array()),
        readLink: () => Effect.succeed(""),
        realPath: (path) => Effect.succeed(path),
        remove: () => Effect.void,
        rename: () => Effect.void,
        sink: () => ({} as any),
        stat: () => Effect.succeed({} as any),
        stream: () => ({} as any),
        symlink: () => Effect.void,
        truncate: () => Effect.void,
        utimes: () => Effect.void,
        watch: () => ({} as any),
        writeFile: () => Effect.void
      })
    })
  )

// Helper to get files from mock FS
const getFiles = (filesRef: Ref.Ref<Record<string, MockFile>>) =>
  Ref.get(filesRef)

// ============================================================================
// Config Loading Tests
// ============================================================================

describe("AppConfig loading", () => {
  it.effect("loads valid config file", () =>
    Effect.gen(function* () {
      const validConfig = JSON.stringify({
        pihole: {
          url: "http://pihole.local",
          password: "secret123"
        },
        dnsProvider: {
          type: "cloudflare",
          apiToken: "cf-token",
          zoneId: "zone-abc",
          zone: "example.com"
        },
        backup: {
          path: "/home/user/backups"
        }
      })

      const fsLayer = makeMockFileSystem({
        [AppConfig.CONFIG_FILE]: { content: validConfig, isDirectory: false }
      })

      const testLayer = Layer.provideMerge(AppConfig.layer, fsLayer)
      const config = yield* AppConfig.pipe(Effect.provide(testLayer))

      expect(config.pihole.url).toBe("http://pihole.local")
      expect(Redacted.value(config.pihole.password)).toBe("secret123")
      expect(config.dnsProvider.type).toBe("cloudflare")
      expect(config.backup.path).toBe("/home/user/backups")
      expect(config.configPath).toBe(AppConfig.CONFIG_FILE)
    })
  )

  it.effect("loads config with porkbun provider", () =>
    Effect.gen(function* () {
      const porkbunConfig = JSON.stringify({
        pihole: {
          url: "http://pihole.local",
          password: "secret"
        },
        dnsProvider: {
          type: "porkbun",
          apiKey: "pk_abc",
          secretKey: "sk_xyz",
          domain: "example.com"
        },
        backup: {
          path: "/backups"
        }
      })

      const fsLayer = makeMockFileSystem({
        [AppConfig.CONFIG_FILE]: { content: porkbunConfig, isDirectory: false }
      })

      const testLayer = Layer.provideMerge(AppConfig.layer, fsLayer)
      const config = yield* AppConfig.pipe(Effect.provide(testLayer))

      expect(config.dnsProvider.type).toBe("porkbun")
    })
  )

  it.effect("fails with ConfigNotFoundError when file missing", () =>
    Effect.gen(function* () {
      const fsLayer = makeMockFileSystem({}) // Empty FS

      const testLayer = Layer.provideMerge(AppConfig.layer, fsLayer)
      const result = yield* AppConfig.pipe(
        Effect.provide(testLayer),
        Effect.either
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ConfigNotFoundError")
      }
    })
  )

  it.effect("fails with ConfigParseError on invalid JSON", () =>
    Effect.gen(function* () {
      const fsLayer = makeMockFileSystem({
        [AppConfig.CONFIG_FILE]: { content: "not valid json {{{", isDirectory: false }
      })

      const testLayer = Layer.provideMerge(AppConfig.layer, fsLayer)
      const result = yield* AppConfig.pipe(
        Effect.provide(testLayer),
        Effect.either
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ConfigParseError")
      }
    })
  )

  it.effect("fails with ConfigParseError on missing required fields", () =>
    Effect.gen(function* () {
      const incompleteConfig = JSON.stringify({
        pihole: {
          url: "http://pihole.local"
          // Missing password
        },
        dnsProvider: {
          type: "cloudflare"
          // Missing other fields
        },
        backup: {
          path: "/backups"
        }
      })

      const fsLayer = makeMockFileSystem({
        [AppConfig.CONFIG_FILE]: { content: incompleteConfig, isDirectory: false }
      })

      const testLayer = Layer.provideMerge(AppConfig.layer, fsLayer)
      const result = yield* AppConfig.pipe(
        Effect.provide(testLayer),
        Effect.either
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ConfigParseError")
      }
    })
  )

  it.effect("fails with ConfigParseError on invalid provider type", () =>
    Effect.gen(function* () {
      const invalidProvider = JSON.stringify({
        pihole: {
          url: "http://pihole.local",
          password: "secret"
        },
        dnsProvider: {
          type: "unknownprovider", // Invalid type
          someField: "value"
        },
        backup: {
          path: "/backups"
        }
      })

      const fsLayer = makeMockFileSystem({
        [AppConfig.CONFIG_FILE]: { content: invalidProvider, isDirectory: false }
      })

      const testLayer = Layer.provideMerge(AppConfig.layer, fsLayer)
      const result = yield* AppConfig.pipe(
        Effect.provide(testLayer),
        Effect.either
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ConfigParseError")
      }
    })
  )
})

// ============================================================================
// Config Path Constants Tests
// ============================================================================

describe("AppConfig constants", () => {
  it("CONFIG_DIR is in .config/domainarr", () => {
    expect(AppConfig.CONFIG_DIR).toContain(".config")
    expect(AppConfig.CONFIG_DIR).toContain("domainarr")
  })

  it("CONFIG_FILE is config.json in CONFIG_DIR", () => {
    expect(AppConfig.CONFIG_FILE).toContain(AppConfig.CONFIG_DIR)
    expect(AppConfig.CONFIG_FILE).toContain("config.json")
  })
})

// ============================================================================
// Redacted Password Tests
// ============================================================================

describe("AppConfig password handling", () => {
  it.effect("password is Redacted and not exposed in logs", () =>
    Effect.gen(function* () {
      const config = JSON.stringify({
        pihole: {
          url: "http://pihole.local",
          password: "supersecret"
        },
        dnsProvider: {
          type: "cloudflare",
          apiToken: "cf-token",
          zoneId: "zone",
          zone: "example.com"
        },
        backup: { path: "/backups" }
      })

      const fsLayer = makeMockFileSystem({
        [AppConfig.CONFIG_FILE]: { content: config, isDirectory: false }
      })

      const testLayer = Layer.provideMerge(AppConfig.layer, fsLayer)
      const appConfig = yield* AppConfig.pipe(Effect.provide(testLayer))

      // Password is Redacted
      expect(Redacted.isRedacted(appConfig.pihole.password)).toBe(true)

      // Can get value with explicit call
      expect(Redacted.value(appConfig.pihole.password)).toBe("supersecret")

      // String representation is redacted
      const passwordStr = String(appConfig.pihole.password)
      expect(passwordStr).not.toContain("supersecret")
    })
  )
})

// ============================================================================
// DNS Provider Config Discrimination Tests
// ============================================================================

describe("DnsProviderConfig discrimination", () => {
  it.effect("correctly discriminates cloudflare config", () =>
    Effect.gen(function* () {
      const config = JSON.stringify({
        pihole: { url: "http://pihole.local", password: "secret" },
        dnsProvider: {
          type: "cloudflare",
          apiToken: "cf-token",
          zoneId: "zone-123",
          zone: "example.com"
        },
        backup: { path: "/backups" }
      })

      const fsLayer = makeMockFileSystem({
        [AppConfig.CONFIG_FILE]: { content: config, isDirectory: false }
      })

      const testLayer = Layer.provideMerge(AppConfig.layer, fsLayer)
      const appConfig = yield* AppConfig.pipe(Effect.provide(testLayer))

      if (appConfig.dnsProvider.type === "cloudflare") {
        expect(appConfig.dnsProvider.zoneId).toBe("zone-123")
        expect(appConfig.dnsProvider.zone).toBe("example.com")
        expect(Redacted.value(appConfig.dnsProvider.apiToken)).toBe("cf-token")
      } else {
        throw new Error("Expected cloudflare config")
      }
    })
  )

  it.effect("correctly discriminates porkbun config", () =>
    Effect.gen(function* () {
      const config = JSON.stringify({
        pihole: { url: "http://pihole.local", password: "secret" },
        dnsProvider: {
          type: "porkbun",
          apiKey: "pk_abc123",
          secretKey: "sk_xyz789",
          domain: "example.com"
        },
        backup: { path: "/backups" }
      })

      const fsLayer = makeMockFileSystem({
        [AppConfig.CONFIG_FILE]: { content: config, isDirectory: false }
      })

      const testLayer = Layer.provideMerge(AppConfig.layer, fsLayer)
      const appConfig = yield* AppConfig.pipe(Effect.provide(testLayer))

      if (appConfig.dnsProvider.type === "porkbun") {
        expect(appConfig.dnsProvider.domain).toBe("example.com")
        expect(Redacted.value(appConfig.dnsProvider.apiKey)).toBe("pk_abc123")
        expect(Redacted.value(appConfig.dnsProvider.secretKey)).toBe("sk_xyz789")
      } else {
        throw new Error("Expected porkbun config")
      }
    })
  )
})

// ============================================================================
// ConfigShape Interface Tests
// ============================================================================

describe("AppConfigShape", () => {
  it.effect("provides all required fields", () =>
    Effect.gen(function* () {
      const config = JSON.stringify({
        pihole: { url: "http://test", password: "pass" },
        dnsProvider: {
          type: "cloudflare",
          apiToken: "token",
          zoneId: "zone",
          zone: "test.com"
        },
        backup: { path: "/backups" }
      })

      const fsLayer = makeMockFileSystem({
        [AppConfig.CONFIG_FILE]: { content: config, isDirectory: false }
      })

      const testLayer = Layer.provideMerge(AppConfig.layer, fsLayer)
      const appConfig = yield* AppConfig.pipe(Effect.provide(testLayer))

      // Verify all fields exist
      expect(appConfig.pihole).toBeDefined()
      expect(appConfig.pihole.url).toBeDefined()
      expect(appConfig.pihole.password).toBeDefined()
      expect(appConfig.dnsProvider).toBeDefined()
      expect(appConfig.dnsProvider.type).toBeDefined()
      expect(appConfig.backup).toBeDefined()
      expect(appConfig.backup.path).toBeDefined()
      expect(appConfig.configPath).toBeDefined()
    })
  )
})

// ============================================================================
// Edge Cases
// ============================================================================

describe("AppConfig edge cases", () => {
  it.effect("handles trailing slash in pihole url", () =>
    Effect.gen(function* () {
      const config = JSON.stringify({
        pihole: { url: "http://pihole.local/", password: "pass" },
        dnsProvider: {
          type: "cloudflare",
          apiToken: "token",
          zoneId: "zone",
          zone: "test.com"
        },
        backup: { path: "/backups" }
      })

      const fsLayer = makeMockFileSystem({
        [AppConfig.CONFIG_FILE]: { content: config, isDirectory: false }
      })

      const testLayer = Layer.provideMerge(AppConfig.layer, fsLayer)
      const appConfig = yield* AppConfig.pipe(Effect.provide(testLayer))

      // URL is stored as-is (normalization happens in PiholeClient)
      expect(appConfig.pihole.url).toBe("http://pihole.local/")
    })
  )

  it.effect("handles unicode in paths", () =>
    Effect.gen(function* () {
      const config = JSON.stringify({
        pihole: { url: "http://pihole.local", password: "pass" },
        dnsProvider: {
          type: "cloudflare",
          apiToken: "token",
          zoneId: "zone",
          zone: "test.com"
        },
        backup: { path: "/home/用户/backups" }
      })

      const fsLayer = makeMockFileSystem({
        [AppConfig.CONFIG_FILE]: { content: config, isDirectory: false }
      })

      const testLayer = Layer.provideMerge(AppConfig.layer, fsLayer)
      const appConfig = yield* AppConfig.pipe(Effect.provide(testLayer))

      expect(appConfig.backup.path).toBe("/home/用户/backups")
    })
  )
})
