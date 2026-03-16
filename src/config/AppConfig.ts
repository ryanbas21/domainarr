import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { FileSystem } from "@effect/platform"
import * as Path from "node:path"
import * as Os from "node:os"
import { ConfigNotFoundError, ConfigParseError, ConfigReadError, ConfigWriteError } from "../domain/errors.js"
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
    FileSystem.FileSystem.pipe(
      Effect.flatMap((fs) =>
        fs.exists(AppConfig.CONFIG_FILE).pipe(
          Effect.filterOrFail(
            (exists) => exists,
            () => new ConfigNotFoundError({ path: AppConfig.CONFIG_FILE })
          ),
          Effect.andThen(
            fs.readFileString(AppConfig.CONFIG_FILE).pipe(
              Effect.mapError((e) => new ConfigReadError({
                path: AppConfig.CONFIG_FILE,
                message: `Failed to read config: ${e instanceof Error ? e.message : String(e)}`
              }))
            )
          ),
          Effect.flatMap((content) =>
            Schema.decodeUnknown(Schema.parseJson(ConfigFile))(content).pipe(
              Effect.mapError((e) => new ConfigParseError({ message: String(e) }))
            )
          ),
          Effect.map((parsed) =>
            AppConfig.of({
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
          )
        )
      )
    )
  )

  // JSON encoder for config file (uses Schema.Redacted which encodes to plain string)
  private static readonly ConfigFileJson = Schema.parseJson(ConfigFile)

  // For `domainarr init` - write initial config
  static writeConfig = (config: Omit<AppConfigShape, "configPath">) =>
    FileSystem.FileSystem.pipe(
      Effect.tap((fs) => fs.makeDirectory(AppConfig.CONFIG_DIR, { recursive: true })),
      Effect.flatMap((fs) =>
        Schema.encode(AppConfig.ConfigFileJson)({
          pihole: {
            url: config.pihole.url,
            password: config.pihole.password
          },
          dnsProvider: config.dnsProvider,
          backup: {
            path: config.backup.path
          }
        }).pipe(
          Effect.flatMap((json) => fs.writeFileString(AppConfig.CONFIG_FILE, json))
        )
      ),
      Effect.andThen(
        Effect.tryPromise({
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
      ),
      Effect.withSpan("AppConfig.writeConfig")
    )
}
