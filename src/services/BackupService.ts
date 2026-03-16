import { Context, Effect, Layer, Schema } from "effect"
import { FileSystem, Path } from "@effect/platform"
import { AppConfig } from "../config/AppConfig.js"
import { PiholeClient } from "./PiholeClient.js"
import { DnsProvider, type DnsProviderErrors } from "./DnsProvider.js"
import { DnsBackup, DnsRecord, type Domain } from "../domain/DnsRecord.js"
import {
  BackupWriteError,
  BackupReadError,
  type BackupError,
  type PiholeError
} from "../domain/errors.js"

export class BackupService extends Context.Tag("@domainarr/BackupService")<
  BackupService,
  {
    // Create a backup from current state
    readonly backup: () => Effect.Effect<string, PiholeError | DnsProviderErrors | BackupError>

    // List available backups
    readonly listBackups: () => Effect.Effect<ReadonlyArray<string>, BackupError>

    // Restore from a backup file - returns success/failure counts
    readonly restore: (backupFile: string) => Effect.Effect<
      {
        pihole: { restored: number; failed: number; errors: string[] }
        dnsProvider: { restored: number; failed: number; errors: string[] }
      },
      BackupError
    >
  }
>() {
  static readonly layer = Layer.effect(
    BackupService,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const pihole = yield* PiholeClient
      const dnsProvider = yield* DnsProvider

      const backupDir = config.backup.path

      // Generate backup filename with timestamp
      const generateFilename = () => {
        const now = new Date()
        const timestamp = now.toISOString().replace(/[:.]/g, "-")
        return `domainarr-backup-${timestamp}.json`
      }

      // Create a backup
      const backup = Effect.fn("BackupService.backup")(function* () {
        // Fetch current records from both providers
        const [piholeRecords, dnsProviderRecords] = yield* Effect.all([
          pihole.list(),
          dnsProvider.list()
        ])

        // Create backup object
        const backupData = DnsBackup.make({
          version: 1,
          timestamp: new Date(),
          pihole: [...piholeRecords],
          dnsProvider: [...dnsProviderRecords]
        })

        // Ensure backup directory exists
        yield* fs.makeDirectory(backupDir, { recursive: true }).pipe(
          Effect.mapError((e) =>
            new BackupWriteError({
              path: backupDir,
              message: `Failed to create directory: ${e}`
            })
          )
        )

        // Write backup file
        const filename = generateFilename()
        const filepath = path.join(backupDir, filename)

        const json = yield* Schema.encode(DnsBackup.Json)(backupData).pipe(
          Effect.mapError((e) =>
            new BackupWriteError({
              path: filepath,
              message: `Failed to encode backup: ${e}`
            })
          )
        )

        yield* fs.writeFileString(filepath, json).pipe(
          Effect.mapError((e) =>
            new BackupWriteError({
              path: filepath,
              message: `Failed to write file: ${e}`
            })
          )
        )

        return filepath
      })

      // List available backups
      const listBackups = Effect.fn("BackupService.listBackups")(function* () {
        const exists = yield* fs.exists(backupDir).pipe(
          Effect.mapError((e) =>
            new BackupReadError({
              path: backupDir,
              message: `Failed to check directory: ${e}`
            })
          )
        )
        if (!exists) {
          return [] as string[]
        }

        const entries = yield* fs.readDirectory(backupDir).pipe(
          Effect.mapError((e) =>
            new BackupReadError({
              path: backupDir,
              message: `Failed to read directory: ${e}`
            })
          )
        )

        // Filter for domainarr backup files and sort by name (newest first)
        return entries
          .filter((entry) => entry.startsWith("domainarr-backup-") && entry.endsWith(".json"))
          .sort()
          .reverse()
      })

      // Restore from a backup
      const restore = Effect.fn("BackupService.restore")(function* (backupFile: string) {
        // Resolve path (support both filename and full path)
        const filepath = path.isAbsolute(backupFile)
          ? backupFile
          : path.join(backupDir, backupFile)

        yield* Effect.logInfo(`Restoring from backup: ${filepath}`).pipe(
          Effect.annotateLogs({ service: "backup", operation: "restore" })
        )

        // Read backup file
        const content = yield* fs.readFileString(filepath).pipe(
          Effect.mapError((e) =>
            new BackupReadError({
              path: filepath,
              message: `Failed to read file: ${e}`
            })
          )
        )

        // Parse backup
        const backupData = yield* Schema.decode(DnsBackup.Json)(content).pipe(
          Effect.mapError((e) =>
            new BackupReadError({
              path: filepath,
              message: `Failed to parse backup: ${e}`
            })
          )
        )

        // Clear existing records before restoring (true restore)
        yield* Effect.logInfo("Clearing existing records before restore...").pipe(
          Effect.annotateLogs({ service: "backup", operation: "restore" })
        )

        const existingPiholeRecords = yield* pihole.list().pipe(
          Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<DnsRecord>))
        )
        yield* Effect.forEach(
          existingPiholeRecords,
          (record) => pihole.remove(record).pipe(Effect.catchAll(() => Effect.void)),
          { concurrency: 1 }
        )

        const existingDnsProviderRecords = yield* dnsProvider.list().pipe(
          Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<{ domain: string }>))
        )
        yield* Effect.forEach(
          existingDnsProviderRecords,
          (record) => dnsProvider.remove(record.domain as Domain).pipe(Effect.catchAll(() => Effect.void)),
          { concurrency: 5 }
        )

        yield* Effect.logInfo(
          `Cleared ${existingPiholeRecords.length} Pi-hole and ${existingDnsProviderRecords.length} DNS provider records`
        ).pipe(Effect.annotateLogs({ service: "backup", operation: "restore" }))

        // Restore to Pi-hole using Effect.forEach
        yield* Effect.logInfo(`Restoring ${backupData.pihole.length} records to Pi-hole...`).pipe(
          Effect.annotateLogs({ service: "backup", operation: "restore" })
        )

        const piholeResultsList = yield* Effect.forEach(
          backupData.pihole,
          (record) =>
            pihole.add(record).pipe(
              Effect.map(() => ({ domain: record.domain, success: true as const })),
              Effect.catchAll((e) => {
                return Effect.logWarning(`Failed to restore ${record.domain}: ${e.message}`).pipe(
                  Effect.annotateLogs({ service: "backup", target: "pihole" }),
                  Effect.as({ domain: record.domain, success: false as const, error: e.message })
                )
              })
            ),
          { concurrency: 1 } // Sequential to avoid overwhelming Pi-hole
        )

        const piholeResults = {
          restored: piholeResultsList.filter((r) => r.success).length,
          failed: piholeResultsList.filter((r) => !r.success).length,
          errors: piholeResultsList.filter((r): r is typeof r & { success: false; error: string } => !r.success)
            .map((r) => `${r.domain}: ${r.error}`)
        }

        // Restore to DNS provider using Effect.forEach
        yield* Effect.logInfo(`Restoring ${backupData.dnsProvider.length} records to DNS provider...`).pipe(
          Effect.annotateLogs({ service: "backup", operation: "restore" })
        )

        const dnsProviderResultsList = yield* Effect.forEach(
          backupData.dnsProvider,
          (record) => {
            const dnsRecord = DnsRecord.make({
              domain: record.domain,
              ip: record.ip
            })
            return dnsProvider.upsert(dnsRecord).pipe(
              Effect.map(() => ({ domain: record.domain, success: true as const })),
              Effect.catchAll((e) => {
                return Effect.logWarning(`Failed to restore ${record.domain}: ${e.message}`).pipe(
                  Effect.annotateLogs({ service: "backup", target: "dnsProvider" }),
                  Effect.as({ domain: record.domain, success: false as const, error: e.message })
                )
              })
            )
          },
          { concurrency: 5 } // Allow some parallelism for DNS provider
        )

        const dnsProviderResults = {
          restored: dnsProviderResultsList.filter((r) => r.success).length,
          failed: dnsProviderResultsList.filter((r) => !r.success).length,
          errors: dnsProviderResultsList.filter((r): r is typeof r & { success: false; error: string } => !r.success)
            .map((r) => `${r.domain}: ${r.error}`)
        }

        yield* Effect.logInfo(
          `Restore complete: Pi-hole ${piholeResults.restored}/${backupData.pihole.length}, ` +
          `DNS Provider ${dnsProviderResults.restored}/${backupData.dnsProvider.length}`
        ).pipe(Effect.annotateLogs({ service: "backup", operation: "restore" }))

        return { pihole: piholeResults, dnsProvider: dnsProviderResults }
      })

      return BackupService.of({ backup, listBackups, restore })
    })
  )
}
