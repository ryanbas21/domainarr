import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { FileSystem } from "@effect/platform"
import * as Path from "node:path"
import * as Os from "node:os"
import { ConfigNotFoundError, ConfigParseError, ConfigWriteError } from "../domain/errors.js"
import { CloudflareConfig } from "../services/providers/cloudflare.js"
import { PorkbunConfig } from "../services/providers/porkbun.js"

// Pi-hole config schema
const PiholeConfig = Schema.Struct({
  url: Schema.String,
  password: Schema.Redacted(Schema.String)
})

// DNS provider union - extensible for new providers
const DnsProviderConfig = Schema.Union(CloudflareConfig, PorkbunConfig)
export type DnsProviderConfig = typeof DnsProviderConfig.Type

// Backup config schema
const BackupConfig = Schema.Struct({
  path: Schema.String
})

// Full config file schema
const ConfigFile = Schema.Struct({
  pihole: PiholeConfig,
  dnsProvider: DnsProviderConfig,
  backup: BackupConfig
})

type ConfigFile = typeof ConfigFile.Type

// Public config interface (exposed to services)
export interface AppConfigShape {
  readonly pihole: {
    readonly url: string
    readonly password: Redacted.Redacted<string>
  }
  readonly dnsProvider: DnsProviderConfig
  readonly backup: {
    readonly path: string
  }
  readonly configPath: string
}

export class AppConfig extends Context.Tag("@domainarr/AppConfig")<
  AppConfig,
  AppConfigShape
>() {
  static readonly CONFIG_DIR = Path.join(Os.homedir(), ".config", "domainarr")
  static readonly CONFIG_FILE = Path.join(AppConfig.CONFIG_DIR, "config.json")

  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem

      // Check if config exists
      const exists = yield* fs.exists(AppConfig.CONFIG_FILE)
      if (!exists) {
        return yield* new ConfigNotFoundError({ path: AppConfig.CONFIG_FILE })
      }

      // Read and parse config
      const content = yield* fs.readFileString(AppConfig.CONFIG_FILE).pipe(
        Effect.mapError(() => new ConfigNotFoundError({ path: AppConfig.CONFIG_FILE }))
      )

      const parsed = yield* Schema.decodeUnknown(Schema.parseJson(ConfigFile))(content).pipe(
        Effect.mapError((e) => new ConfigParseError({ message: String(e) }))
      )

      return AppConfig.of({
        pihole: {
          url: parsed.pihole.url,
          password: parsed.pihole.password
        },
        dnsProvider: parsed.dnsProvider,
        backup: {
          path: parsed.backup.path
        },
        configPath: AppConfig.CONFIG_FILE
      })
    })
  )

  // JSON encoder for config file (uses Schema.Redacted which encodes to plain string)
  private static readonly ConfigFileJson = Schema.parseJson(ConfigFile)

  // For `domainarr init` - write initial config
  static writeConfig = Effect.fn("AppConfig.writeConfig")(function* (
    config: Omit<AppConfigShape, "configPath">
  ) {
    const fs = yield* FileSystem.FileSystem

    // Ensure directory exists
    yield* fs.makeDirectory(AppConfig.CONFIG_DIR, { recursive: true })

    // Encode config to JSON using Schema (handles Redacted → plain string)
    const json = yield* Schema.encode(AppConfig.ConfigFileJson)({
      pihole: {
        url: config.pihole.url,
        password: config.pihole.password
      },
      dnsProvider: config.dnsProvider,
      backup: {
        path: config.backup.path
      }
    })

    yield* fs.writeFileString(AppConfig.CONFIG_FILE, json)

    // Set restrictive permissions (owner read/write only)
    yield* Effect.tryPromise({
      try: () =>
        import("node:fs/promises").then((fs) =>
          fs.chmod(AppConfig.CONFIG_FILE, 0o600)
        ),
      catch: (e) =>
        new ConfigWriteError({
          path: AppConfig.CONFIG_FILE,
          message: `Failed to set secure permissions: ${e instanceof Error ? e.message : String(e)}`
        })
    })
  })
}
