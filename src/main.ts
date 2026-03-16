#!/usr/bin/env node
import { Command } from "@effect/cli"
import { NodeContext, NodeHttpClient, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer, Redacted } from "effect"
import { rootCommand, initCommand } from "./cli/commands.js"
import { AppConfig, type DnsProviderConfig } from "./config/AppConfig.js"
import { PiholeClient } from "./services/PiholeClient.js"
import { DnsProvider } from "./services/DnsProvider.js"
import { makeCloudflareProvider, makePorkbunProvider } from "./services/providers/index.js"
import { DomainManager } from "./services/DomainManager.js"
import { BackupService } from "./services/BackupService.js"
import { CliLoggerLive } from "./services/Logger.js"

// Select DNS provider layer based on config type
const makeDnsProviderLayer = (config: DnsProviderConfig): Layer.Layer<DnsProvider> => {
  switch (config.type) {
    case "cloudflare":
      return makeCloudflareProvider(config)
    case "porkbun":
      return makePorkbunProvider(config)
    default: {
      // Exhaustiveness check - TypeScript will error if a case is missing
      const _exhaustive: never = config
      throw new Error(`Unknown DNS provider type: ${(_exhaustive as { type: string }).type}`)
    }
  }
}

// Check if this is a command that doesn't need full config
const args = process.argv.slice(2)
const isInitCommand = args[0] === "init"
const isHelpOrVersion = args.includes("--help") || args.includes("-h") || args.includes("--version")

// Platform layers (no dependencies)
const PlatformLayer = Layer.merge(NodeContext.layer, NodeHttpClient.layer)

if (isInitCommand) {
  // Init command has its own simpler setup - only needs filesystem
  const initCli = Command.run(initCommand, {
    name: "domainarr",
    version: "1.0.0"
  })

  initCli(process.argv).pipe(
    Effect.provide(NodeContext.layer),
    NodeRuntime.runMain
  )
} else {
  // Full CLI with all services
  const cli = Command.run(rootCommand, {
    name: "domainarr",
    version: "1.0.0"
  })

  // For help/version, use stub services that won't be called
  // For actual commands, use real config-based services
  if (isHelpOrVersion) {
    // Stub config and provider for help/version (never actually used)
    const StubConfigLayer = Layer.succeed(AppConfig, {
      pihole: { url: "", password: Redacted.make("") },
      dnsProvider: { type: "cloudflare" as const, apiToken: Redacted.make(""), zoneId: "", zone: "" },
      backup: { path: "" },
      configPath: ""
    })

    // Stub provider that throws if actually called - for help/version display only
    const StubProviderLayer = Layer.succeed(DnsProvider, {
      name: "stub",
      list: () => Effect.die("Stub provider should not be called"),
      find: () => Effect.die("Stub provider should not be called"),
      add: () => Effect.die("Stub provider should not be called"),
      remove: () => Effect.die("Stub provider should not be called"),
      upsert: () => Effect.die("Stub provider should not be called")
    })

    const PiholeLayer = PiholeClient.layer.pipe(
      Layer.provide(StubConfigLayer),
      Layer.provide(PlatformLayer)
    )

    const ClientsLayer = Layer.merge(PiholeLayer, StubProviderLayer)
    const DomainManagerLayer = DomainManager.layer.pipe(Layer.provide(ClientsLayer))
    const BackupLayer = BackupService.layer.pipe(
      Layer.provide(ClientsLayer),
      Layer.provide(StubConfigLayer),
      Layer.provide(PlatformLayer)
    )

    const HelpLayer = Layer.mergeAll(
      CliLoggerLive,
      PlatformLayer,
      StubConfigLayer,
      ClientsLayer,
      DomainManagerLayer,
      BackupLayer
    )

    cli(process.argv).pipe(
      Effect.provide(HelpLayer),
      NodeRuntime.runMain()
    )
  } else {
    // Build the full layer dynamically based on config
    const program = Effect.gen(function* () {
      const config = yield* AppConfig

      // Create provider layer based on config type
      const DnsProviderLayer = makeDnsProviderLayer(config.dnsProvider)

      // Build remaining layers
      const ConfigLayer = Layer.succeed(AppConfig, config)

      const PiholeLayer = PiholeClient.layer.pipe(
        Layer.provide(ConfigLayer),
        Layer.provide(PlatformLayer)
      )

      const ClientsLayer = Layer.merge(PiholeLayer, DnsProviderLayer)

      const DomainManagerLayer = DomainManager.layer.pipe(Layer.provide(ClientsLayer))

      const BackupLayer = BackupService.layer.pipe(
        Layer.provide(ClientsLayer),
        Layer.provide(ConfigLayer),
        Layer.provide(PlatformLayer)
      )

      const MainLayer = Layer.mergeAll(
        CliLoggerLive,
        PlatformLayer,
        ConfigLayer,
        ClientsLayer,
        DomainManagerLayer,
        BackupLayer
      )

      // Run CLI with the dynamically constructed layer
      yield* cli(process.argv).pipe(Effect.provide(MainLayer))
    })

    // Load config first, then run
    program.pipe(
      Effect.provide(AppConfig.layer.pipe(Layer.provide(PlatformLayer))),
      Effect.catchTag("ConfigNotFoundError", () =>
        Console.error(
          "Error: Configuration not found.\n\nRun 'domainarr init' to set up your configuration."
        )
      ),
      Effect.catchTag("ConfigParseError", (e) =>
        Console.error(
          `Error: Invalid configuration file.\n\n${e.message}\n\nRun 'domainarr init' to reconfigure.`
        )
      ),
      Effect.catchTag("ConfigWriteError", (e) =>
        Console.error(
          `Error: Failed to write configuration.\n\n${e.message}`
        )
      ),
      NodeRuntime.runMain()
    )
  }
}
