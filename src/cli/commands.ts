import { Args, Command } from "@effect/cli"
import { Console, Effect, Schema } from "effect"
import { DnsRecord, Domain, IpAddress } from "../domain/DnsRecord.js"
import { DomainManager } from "../services/DomainManager.js"
import { BackupService } from "../services/BackupService.js"
import { AppConfig } from "../config/AppConfig.js"
import { promptForConfig } from "./prompts.js"

// ============================================================================
// Add Command
// ============================================================================
const domainArg = Args.text({ name: "domain" }).pipe(
  Args.withDescription("Domain name (e.g., homarr.example.xyz)")
)

const ipArg = Args.text({ name: "ip" }).pipe(
  Args.withDescription("IP address (e.g., 192.168.1.50)")
)

const addCommand = Command.make(
  "add",
  { domain: domainArg, ip: ipArg },
  ({ domain, ip }) =>
    Effect.gen(function* () {
      const manager = yield* DomainManager

      // Decode and validate branded types
      const validDomain = yield* Schema.decode(Domain)(domain).pipe(
        Effect.catchAll(() =>
          Console.error(`Invalid domain format: ${domain}`).pipe(
            Effect.andThen(Effect.sync(() => { process.exitCode = 1 })),
            Effect.andThen(Effect.interrupt)
          )
        )
      )
      const validIp = yield* Schema.decode(IpAddress)(ip).pipe(
        Effect.catchAll(() =>
          Console.error(`Invalid IP address format: ${ip}`).pipe(
            Effect.andThen(Effect.sync(() => { process.exitCode = 1 })),
            Effect.andThen(Effect.interrupt)
          )
        )
      )

      const record = DnsRecord.make({
        domain: validDomain,
        ip: validIp
      })

      yield* Console.log(`Adding ${domain} → ${ip}...`)

      const result = yield* manager.add(record)

      // Report results
      if (result.pihole === "success") {
        yield* Console.log(`  ✓ Pi-hole: added`)
      } else if (result.pihole === "failed") {
        yield* Console.log(`  ✗ Pi-hole: ${result.piholeError}`)
      }

      if (result.dnsProvider === "success") {
        yield* Console.log(`  ✓ DNS Provider: added`)
      } else if (result.dnsProvider === "failed") {
        yield* Console.log(`  ✗ DNS Provider: ${result.dnsProviderError}`)
      }

      const allSuccess =
        result.pihole === "success" && result.dnsProvider === "success"
      if (!allSuccess) {
        yield* Console.log(`\nSome operations failed. Check the errors above.`)
      }
    })
).pipe(Command.withDescription("Add a DNS record to Pi-hole and DNS provider"))

// ============================================================================
// Remove Command
// ============================================================================
const removeCommand = Command.make(
  "remove",
  { domain: domainArg },
  ({ domain }) =>
    Effect.gen(function* () {
      const manager = yield* DomainManager

      // Decode and validate domain
      const validDomain = yield* Schema.decode(Domain)(domain).pipe(
        Effect.catchAll(() =>
          Console.error(`Invalid domain format: ${domain}`).pipe(
            Effect.andThen(Effect.sync(() => { process.exitCode = 1 })),
            Effect.andThen(Effect.interrupt)
          )
        )
      )

      yield* Console.log(`Removing ${domain}...`)

      const result = yield* manager.remove(validDomain)

      if (result.pihole === "success") {
        yield* Console.log(`  ✓ Pi-hole: removed`)
      } else if (result.pihole === "failed") {
        yield* Console.log(`  ✗ Pi-hole: ${result.piholeError}`)
      } else {
        yield* Console.log(`  - Pi-hole: not found`)
      }

      if (result.dnsProvider === "success") {
        yield* Console.log(`  ✓ DNS Provider: removed`)
      } else if (result.dnsProvider === "failed") {
        yield* Console.log(`  ✗ DNS Provider: ${result.dnsProviderError}`)
      }
    })
).pipe(Command.withDescription("Remove a DNS record from Pi-hole and DNS provider"))

// ============================================================================
// List Command
// ============================================================================
const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const manager = yield* DomainManager

    yield* Console.log("Fetching DNS records...\n")

    const records = yield* manager.list()

    if (records.length === 0) {
      yield* Console.log("No DNS records found.")
      return
    }

    // Format as table
    yield* Console.log("Domain                              IP              Pi-hole  DNS Provider")
    yield* Console.log("─".repeat(75))

    for (const record of records) {
      const pihole = record.inPihole ? "✓" : "-"
      const dnsProvider = record.inDnsProvider ? (record.dnsProviderIp ? "~" : "✓") : "-"
      const domain = record.domain.padEnd(35)
      const ip = record.ip.padEnd(15)
      const drift = record.dnsProviderIp ? ` (DNS: ${record.dnsProviderIp})` : ""
      yield* Console.log(`${domain} ${ip} ${pihole.padEnd(8)} ${dnsProvider}${drift}`)
    }

    yield* Console.log(`\nTotal: ${records.length} records`)
  })
).pipe(Command.withDescription("List all DNS records from Pi-hole and DNS provider"))

// ============================================================================
// Sync Command
// ============================================================================
const syncCommand = Command.make("sync", {}, () =>
  Effect.gen(function* () {
    const manager = yield* DomainManager

    yield* Console.log("Syncing Pi-hole → DNS Provider...\n")

    const results = yield* manager.sync()

    let successCount = 0
    let failCount = 0
    let removedCount = 0

    for (const result of results) {
      const isRemoval = result.pihole === "skipped"
      if (result.dnsProvider === "success") {
        if (isRemoval) {
          yield* Console.log(`  ✓ ${result.domain} (removed — not in Pi-hole)`)
          removedCount++
        } else {
          yield* Console.log(`  ✓ ${result.domain}`)
        }
        successCount++
      } else {
        yield* Console.log(`  ✗ ${result.domain}: ${result.dnsProviderError}`)
        failCount++
      }
    }

    const parts = [`Synced ${successCount - removedCount} records`]
    if (removedCount > 0) parts.push(`removed ${removedCount} stale`)
    if (failCount > 0) parts.push(`${failCount} failed`)
    yield* Console.log(`\n${parts.join(", ")}`)
  })
).pipe(Command.withDescription("Sync DNS records from Pi-hole to DNS provider"))

// ============================================================================
// Backup Command
// ============================================================================
const backupCommand = Command.make("backup", {}, () =>
  Effect.gen(function* () {
    const backup = yield* BackupService

    yield* Console.log("Creating backup...")

    const filepath = yield* backup.backup()

    yield* Console.log(`\n✓ Backup saved to: ${filepath}`)
  })
).pipe(Command.withDescription("Backup DNS records to configured backup directory"))

// ============================================================================
// Restore Command
// ============================================================================
const backupFileArg = Args.text({ name: "backup-file" }).pipe(
  Args.withDescription("Backup filename or full path"),
  Args.optional
)

const restoreCommand = Command.make(
  "restore",
  { backupFile: backupFileArg },
  ({ backupFile }) =>
    Effect.gen(function* () {
      const backup = yield* BackupService

      // If no file specified, list available backups
      if (backupFile._tag === "None") {
        yield* Console.log("Available backups:\n")
        const backups = yield* backup.listBackups()

        if (backups.length === 0) {
          yield* Console.log("No backups found.")
          return
        }

        for (const file of backups) {
          yield* Console.log(`  ${file}`)
        }

        yield* Console.log(`\nUse: domainarr restore <filename>`)
        return
      }

      const result = yield* backup.restore(backupFile.value)

      // Report Pi-hole results
      if (result.pihole.failed === 0) {
        yield* Console.log(`\n✓ Pi-hole: restored ${result.pihole.restored} records`)
      } else {
        yield* Console.log(
          `\n⚠ Pi-hole: restored ${result.pihole.restored}, failed ${result.pihole.failed}`
        )
      }

      // Report DNS provider results
      if (result.dnsProvider.failed === 0) {
        yield* Console.log(`✓ DNS Provider: restored ${result.dnsProvider.restored} records`)
      } else {
        yield* Console.log(
          `⚠ DNS Provider: restored ${result.dnsProvider.restored}, failed ${result.dnsProvider.failed}`
        )
      }

      // Summary
      const totalFailed = result.pihole.failed + result.dnsProvider.failed
      if (totalFailed > 0) {
        yield* Console.log(`\n${totalFailed} record(s) failed to restore. Check the logs above.`)
      }
    })
).pipe(Command.withDescription("Restore DNS records from backup (clears existing records first)"))

// ============================================================================
// Init Command (interactive setup)
// ============================================================================
export const initCommand = Command.make("init", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("Domainarr Setup\n")
    yield* Console.log("This will create a configuration file at:")
    yield* Console.log(`  ${AppConfig.CONFIG_FILE}\n`)

    // Prompt for config values
    const config = yield* promptForConfig

    // Write config
    yield* AppConfig.writeConfig(config)

    yield* Console.log(`\n✓ Configuration saved!`)
    yield* Console.log(`\nYou can now use domainarr commands.`)
  })
).pipe(Command.withDescription("Interactive configuration setup"))

// ============================================================================
// Root Command
// ============================================================================
export const rootCommand = Command.make("domainarr", {}).pipe(
  Command.withDescription("DNS sync CLI for Pi-hole and external DNS providers"),
  Command.withSubcommands([
    addCommand,
    removeCommand,
    listCommand,
    syncCommand,
    backupCommand,
    restoreCommand,
    initCommand
  ])
)
