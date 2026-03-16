/**
 * Tests for BackupService.
 *
 * These tests use in-memory mocks for PiholeClient, DnsProvider,
 * and FileSystem to test backup/restore logic without touching disk.
 */
import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Ref, Schema } from "effect"
import { FileSystem, Path } from "@effect/platform"
import { BackupService } from "../src/services/BackupService.js"
import { AppConfig } from "../src/config/AppConfig.js"
import { DnsBackup, DnsRecord, type Domain, type IpAddress, ProviderDnsRecord } from "../src/domain/DnsRecord.js"
import { BackupWriteError, BackupReadError, PiholeApiError } from "../src/domain/errors.js"
import { DnsProviderError } from "../src/services/DnsProvider.js"
import {
  makeMockPiholeClient,
  makeMockDnsProvider,
  makeMockAppConfig,
  makeTestRecord,
  makeTestProviderRecord,
  makeTestConfig
} from "./helpers.js"

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

        makeDirectory: (path, options) =>
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

        // Stub implementations for other methods
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
        remove: (path) =>
          Ref.update(filesRef, (files) => {
            const newFiles = { ...files }
            delete newFiles[path]
            return newFiles
          }),
        rename: () => Effect.void,
        sink: () => ({} as any),
        stat: (path) =>
          Ref.get(filesRef).pipe(
            Effect.flatMap((files) => {
              if (!(path in files)) {
                return Effect.fail({ _tag: "SystemError", reason: "NotFound", path } as any)
              }
              return Effect.succeed({
                type: files[path].isDirectory ? "Directory" : "File",
                size: files[path].content.length,
                mtime: new Date(),
                atime: new Date(),
                birthtime: new Date()
              } as any)
            })
          ),
        stream: () => ({} as any),
        symlink: () => Effect.void,
        truncate: () => Effect.void,
        utimes: () => Effect.void,
        watch: () => ({} as any),
        writeFile: () => Effect.void
      })
    })
  )

const makeMockPath = () =>
  Layer.succeed(
    Path.Path,
    Path.Path.of({
      basename: (path) => path.split("/").pop() || "",
      dirname: (path) => path.split("/").slice(0, -1).join("/") || "/",
      extname: (path) => {
        const base = path.split("/").pop() || ""
        const dot = base.lastIndexOf(".")
        return dot > 0 ? base.slice(dot) : ""
      },
      isAbsolute: (path) => path.startsWith("/"),
      join: (...paths) => paths.join("/").replace(/\/+/g, "/"),
      normalize: (path) => path,
      parse: (path) => ({
        root: path.startsWith("/") ? "/" : "",
        dir: path.split("/").slice(0, -1).join("/"),
        base: path.split("/").pop() || "",
        ext: "",
        name: path.split("/").pop()?.split(".")[0] || ""
      }),
      relative: (from, to) => to,
      resolve: (...paths) => paths[paths.length - 1] || "/",
      toFileUrl: (path) => new URL(`file://${path}`),
      toNamespacedPath: (path) => path,
      fromFileUrl: (url) => url.pathname,
      sep: "/"
    })
  )

// ============================================================================
// Backup Operation Tests
// ============================================================================

describe("BackupService.backup", () => {
  it.effect("creates backup file with records from both providers", () =>
    Effect.gen(function* () {
      const piholeRecords = [
        makeTestRecord("pihole.example.com", "192.168.1.1")
      ]

      const providerRecords = [
        makeTestProviderRecord("cloud.example.com", "192.168.1.2", "cf-1")
      ]

      const piholeLayer = makeMockPiholeClient({ records: piholeRecords })
      const dnsProviderLayer = makeMockDnsProvider({ records: providerRecords })
      const configLayer = makeMockAppConfig(makeTestConfig({
        backup: { path: "/backups" }
      }))
      const fsLayer = makeMockFileSystem()
      const pathLayer = makeMockPath()

      const testLayer = Layer.provideMerge(
        BackupService.layer,
        Layer.mergeAll(piholeLayer, dnsProviderLayer, configLayer, fsLayer, pathLayer)
      )

      const backupService = yield* BackupService.pipe(Effect.provide(testLayer))
      const filepath = yield* backupService.backup()

      // Verify filename format
      expect(filepath.startsWith("/backups/domainarr-backup-")).toBe(true)
      expect(filepath.endsWith(".json")).toBe(true)
    })
  )

  it.effect("fails when Pi-hole list fails", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({
        error: new PiholeApiError({ message: "Pi-hole down" })
      })
      const dnsProviderLayer = makeMockDnsProvider({ records: [] })
      const configLayer = makeMockAppConfig()
      const fsLayer = makeMockFileSystem()
      const pathLayer = makeMockPath()

      const testLayer = Layer.provideMerge(
        BackupService.layer,
        Layer.mergeAll(piholeLayer, dnsProviderLayer, configLayer, fsLayer, pathLayer)
      )

      const backupService = yield* BackupService.pipe(Effect.provide(testLayer))
      const result = yield* backupService.backup().pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
  )

  it.effect("fails when DNS provider list fails", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({ records: [] })
      const dnsProviderLayer = makeMockDnsProvider({
        error: new DnsProviderError({
          provider: "test",
          message: "Provider error"
        })
      })
      const configLayer = makeMockAppConfig()
      const fsLayer = makeMockFileSystem()
      const pathLayer = makeMockPath()

      const testLayer = Layer.provideMerge(
        BackupService.layer,
        Layer.mergeAll(piholeLayer, dnsProviderLayer, configLayer, fsLayer, pathLayer)
      )

      const backupService = yield* BackupService.pipe(Effect.provide(testLayer))
      const result = yield* backupService.backup().pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
  )
})

// ============================================================================
// List Backups Tests
// ============================================================================

describe("BackupService.listBackups", () => {
  it.effect("returns backup files sorted newest first", () =>
    Effect.gen(function* () {
      const initialFiles: Record<string, MockFile> = {
        "/backups": { content: "", isDirectory: true },
        "/backups/domainarr-backup-2024-01-01T10-00-00.json": { content: "{}", isDirectory: false },
        "/backups/domainarr-backup-2024-01-15T10-00-00.json": { content: "{}", isDirectory: false },
        "/backups/domainarr-backup-2024-01-10T10-00-00.json": { content: "{}", isDirectory: false },
        "/backups/other-file.txt": { content: "", isDirectory: false }
      }

      const piholeLayer = makeMockPiholeClient({ records: [] })
      const dnsProviderLayer = makeMockDnsProvider({ records: [] })
      const configLayer = makeMockAppConfig(makeTestConfig({
        backup: { path: "/backups" }
      }))
      const fsLayer = makeMockFileSystem(initialFiles)
      const pathLayer = makeMockPath()

      const testLayer = Layer.provideMerge(
        BackupService.layer,
        Layer.mergeAll(piholeLayer, dnsProviderLayer, configLayer, fsLayer, pathLayer)
      )

      const backupService = yield* BackupService.pipe(Effect.provide(testLayer))
      const backups = yield* backupService.listBackups()

      expect(backups).toHaveLength(3)
      expect(backups[0]).toBe("domainarr-backup-2024-01-15T10-00-00.json")
      expect(backups[1]).toBe("domainarr-backup-2024-01-10T10-00-00.json")
      expect(backups[2]).toBe("domainarr-backup-2024-01-01T10-00-00.json")
    })
  )

  it.effect("returns empty array when backup directory does not exist", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({ records: [] })
      const dnsProviderLayer = makeMockDnsProvider({ records: [] })
      const configLayer = makeMockAppConfig(makeTestConfig({
        backup: { path: "/nonexistent" }
      }))
      const fsLayer = makeMockFileSystem()
      const pathLayer = makeMockPath()

      const testLayer = Layer.provideMerge(
        BackupService.layer,
        Layer.mergeAll(piholeLayer, dnsProviderLayer, configLayer, fsLayer, pathLayer)
      )

      const backupService = yield* BackupService.pipe(Effect.provide(testLayer))
      const backups = yield* backupService.listBackups()

      expect(backups).toEqual([])
    })
  )

  it.effect("filters to only domainarr backup files", () =>
    Effect.gen(function* () {
      const initialFiles: Record<string, MockFile> = {
        "/backups": { content: "", isDirectory: true },
        "/backups/domainarr-backup-2024-01-01T10-00-00.json": { content: "{}", isDirectory: false },
        "/backups/other-backup.json": { content: "{}", isDirectory: false },
        "/backups/domainarr-config.json": { content: "{}", isDirectory: false },
        "/backups/notes.txt": { content: "", isDirectory: false }
      }

      const piholeLayer = makeMockPiholeClient({ records: [] })
      const dnsProviderLayer = makeMockDnsProvider({ records: [] })
      const configLayer = makeMockAppConfig(makeTestConfig({
        backup: { path: "/backups" }
      }))
      const fsLayer = makeMockFileSystem(initialFiles)
      const pathLayer = makeMockPath()

      const testLayer = Layer.provideMerge(
        BackupService.layer,
        Layer.mergeAll(piholeLayer, dnsProviderLayer, configLayer, fsLayer, pathLayer)
      )

      const backupService = yield* BackupService.pipe(Effect.provide(testLayer))
      const backups = yield* backupService.listBackups()

      expect(backups).toHaveLength(1)
      expect(backups[0]).toBe("domainarr-backup-2024-01-01T10-00-00.json")
    })
  )
})

// ============================================================================
// Restore Operation Tests
// ============================================================================

describe("BackupService.restore", () => {
  it.effect("restores records to both providers", () =>
    Effect.gen(function* () {
      const addedToPihole: DnsRecord[] = []
      const upsertedToProvider: DnsRecord[] = []

      const backup = DnsBackup.make({
        version: 1,
        timestamp: new Date("2024-01-15T10:00:00Z"),
        pihole: [
          DnsRecord.make({ domain: "a.example.com" as Domain, ip: "1.1.1.1" as IpAddress }),
          DnsRecord.make({ domain: "b.example.com" as Domain, ip: "2.2.2.2" as IpAddress })
        ],
        dnsProvider: [
          ProviderDnsRecord.make({ domain: "a.example.com" as Domain, ip: "1.1.1.1" as IpAddress, recordId: "cf-1" })
        ]
      })

      const backupJson = yield* Schema.encode(DnsBackup.Json)(backup)

      const initialFiles: Record<string, MockFile> = {
        "/backups": { content: "", isDirectory: true },
        "/backups/test-backup.json": { content: backupJson, isDirectory: false }
      }

      const piholeLayer = makeMockPiholeClient({
        records: [],
        onAdd: (r) => addedToPihole.push(r)
      })
      const dnsProviderLayer = makeMockDnsProvider({
        records: [],
        onUpsert: (r) => upsertedToProvider.push(r)
      })
      const configLayer = makeMockAppConfig(makeTestConfig({
        backup: { path: "/backups" }
      }))
      const fsLayer = makeMockFileSystem(initialFiles)
      const pathLayer = makeMockPath()

      const testLayer = Layer.provideMerge(
        BackupService.layer,
        Layer.mergeAll(piholeLayer, dnsProviderLayer, configLayer, fsLayer, pathLayer)
      )

      const backupService = yield* BackupService.pipe(Effect.provide(testLayer))
      const result = yield* backupService.restore("test-backup.json")

      expect(result.pihole.restored).toBe(2)
      expect(result.pihole.failed).toBe(0)
      expect(result.dnsProvider.restored).toBe(1)
      expect(result.dnsProvider.failed).toBe(0)

      expect(addedToPihole).toHaveLength(2)
      expect(upsertedToProvider).toHaveLength(1)
    })
  )

  it.effect("supports absolute file paths", () =>
    Effect.gen(function* () {
      const backup = DnsBackup.make({
        version: 1,
        timestamp: new Date(),
        pihole: [],
        dnsProvider: []
      })

      const backupJson = yield* Schema.encode(DnsBackup.Json)(backup)

      const initialFiles: Record<string, MockFile> = {
        "/custom/path/my-backup.json": { content: backupJson, isDirectory: false }
      }

      const piholeLayer = makeMockPiholeClient({ records: [] })
      const dnsProviderLayer = makeMockDnsProvider({ records: [] })
      const configLayer = makeMockAppConfig()
      const fsLayer = makeMockFileSystem(initialFiles)
      const pathLayer = makeMockPath()

      const testLayer = Layer.provideMerge(
        BackupService.layer,
        Layer.mergeAll(piholeLayer, dnsProviderLayer, configLayer, fsLayer, pathLayer)
      )

      const backupService = yield* BackupService.pipe(Effect.provide(testLayer))
      const result = yield* backupService.restore("/custom/path/my-backup.json")

      expect(result.pihole.restored).toBe(0)
      expect(result.dnsProvider.restored).toBe(0)
    })
  )

  it.effect("restore result has expected structure", () =>
    Effect.gen(function* () {
      const backup = DnsBackup.make({
        version: 1,
        timestamp: new Date(),
        pihole: [
          DnsRecord.make({ domain: "good.example.com" as Domain, ip: "1.1.1.1" as IpAddress }),
          DnsRecord.make({ domain: "another.example.com" as Domain, ip: "2.2.2.2" as IpAddress })
        ],
        dnsProvider: []
      })

      const backupJson = yield* Schema.encode(DnsBackup.Json)(backup)

      const initialFiles: Record<string, MockFile> = {
        "/backups": { content: "", isDirectory: true },
        "/backups/test.json": { content: backupJson, isDirectory: false }
      }

      const piholeLayer = makeMockPiholeClient({ records: [] })
      const dnsProviderLayer = makeMockDnsProvider({ records: [] })
      const configLayer = makeMockAppConfig(makeTestConfig({
        backup: { path: "/backups" }
      }))
      const fsLayer = makeMockFileSystem(initialFiles)
      const pathLayer = makeMockPath()

      const testLayer = Layer.provideMerge(
        BackupService.layer,
        Layer.mergeAll(piholeLayer, dnsProviderLayer, configLayer, fsLayer, pathLayer)
      )

      const backupService = yield* BackupService.pipe(Effect.provide(testLayer))
      const result = yield* backupService.restore("test.json")

      // Verify result structure
      expect(result.pihole.restored).toBe(2)
      expect(result.pihole.failed).toBe(0)
      expect(result.pihole.errors).toEqual([])
      expect(result.dnsProvider.restored).toBe(0)
      expect(result.dnsProvider.failed).toBe(0)
      expect(result.dnsProvider.errors).toEqual([])
    })
  )

  it.effect("fails when backup file does not exist", () =>
    Effect.gen(function* () {
      const piholeLayer = makeMockPiholeClient({ records: [] })
      const dnsProviderLayer = makeMockDnsProvider({ records: [] })
      const configLayer = makeMockAppConfig(makeTestConfig({
        backup: { path: "/backups" }
      }))
      const fsLayer = makeMockFileSystem()
      const pathLayer = makeMockPath()

      const testLayer = Layer.provideMerge(
        BackupService.layer,
        Layer.mergeAll(piholeLayer, dnsProviderLayer, configLayer, fsLayer, pathLayer)
      )

      const backupService = yield* BackupService.pipe(Effect.provide(testLayer))
      const result = yield* backupService.restore("nonexistent.json").pipe(Effect.either)

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("BackupReadError")
      }
    })
  )

  it.effect("fails when backup file has invalid JSON", () =>
    Effect.gen(function* () {
      const initialFiles: Record<string, MockFile> = {
        "/backups": { content: "", isDirectory: true },
        "/backups/invalid.json": { content: "not valid json {{{", isDirectory: false }
      }

      const piholeLayer = makeMockPiholeClient({ records: [] })
      const dnsProviderLayer = makeMockDnsProvider({ records: [] })
      const configLayer = makeMockAppConfig(makeTestConfig({
        backup: { path: "/backups" }
      }))
      const fsLayer = makeMockFileSystem(initialFiles)
      const pathLayer = makeMockPath()

      const testLayer = Layer.provideMerge(
        BackupService.layer,
        Layer.mergeAll(piholeLayer, dnsProviderLayer, configLayer, fsLayer, pathLayer)
      )

      const backupService = yield* BackupService.pipe(Effect.provide(testLayer))
      const result = yield* backupService.restore("invalid.json").pipe(Effect.either)

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("BackupReadError")
      }
    })
  )

  it.effect("fails when backup file has invalid schema", () =>
    Effect.gen(function* () {
      const invalidBackup = JSON.stringify({
        version: 999, // Invalid version
        timestamp: new Date().toISOString(),
        pihole: [],
        dnsProvider: []
      })

      const initialFiles: Record<string, MockFile> = {
        "/backups": { content: "", isDirectory: true },
        "/backups/bad-schema.json": { content: invalidBackup, isDirectory: false }
      }

      const piholeLayer = makeMockPiholeClient({ records: [] })
      const dnsProviderLayer = makeMockDnsProvider({ records: [] })
      const configLayer = makeMockAppConfig(makeTestConfig({
        backup: { path: "/backups" }
      }))
      const fsLayer = makeMockFileSystem(initialFiles)
      const pathLayer = makeMockPath()

      const testLayer = Layer.provideMerge(
        BackupService.layer,
        Layer.mergeAll(piholeLayer, dnsProviderLayer, configLayer, fsLayer, pathLayer)
      )

      const backupService = yield* BackupService.pipe(Effect.provide(testLayer))
      const result = yield* backupService.restore("bad-schema.json").pipe(Effect.either)

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("BackupReadError")
      }
    })
  )
})
