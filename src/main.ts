#!/usr/bin/env node
import { Command } from "@effect/cli"
import { NodeContext, NodeHttpClient, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"
import { rootCommand } from "./cli/commands.js"
import { AppConfig, type DnsProviderConfig } from "./config/AppConfig.js"
import { PiholeClient } from "./services/PiholeClient.js"
import { DnsProvider } from "./services/DnsProvider.js"
import { makeCloudflareProvider, makePorkbunProvider } from "./services/providers/index.js"
import { DomainManager } from "./services/DomainManager.js"
import { BackupService } from "./services/BackupService.js"
import { CliLoggerLive } from "./services/Logger.js"

const makeDnsProviderLayer = (config: DnsProviderConfig): Layer.Layer<DnsProvider> => {
  switch (config.type) {
    case "cloudflare":
      return makeCloudflareProvider(config)
    case "porkbun":
      return makePorkbunProvider(config)
    default: {
      const _exhaustive: never = config
      throw new Error(`Unknown DNS provider type: ${(_exhaustive as { type: string }).type}`)
    }
  }
}

const PlatformLayer = Layer.merge(NodeContext.layer, NodeHttpClient.layer)

const ConfigLayer = AppConfig.layer.pipe(Layer.provide(PlatformLayer))

const DnsProviderLayer = Layer.unwrapEffect(
  AppConfig.pipe(Effect.map((config) => makeDnsProviderLayer(config.dnsProvider)))
)

const PiholeLayer = PiholeClient.layer.pipe(
  Layer.provide(ConfigLayer),
  Layer.provide(PlatformLayer)
)

const ClientsLayer = Layer.merge(PiholeLayer, DnsProviderLayer).pipe(
  Layer.provide(ConfigLayer)
)

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

const cli = Command.run(rootCommand, {
  name: "domainarr",
  version: "1.0.0"
})

cli(process.argv).pipe(
  Effect.provide(MainLayer),
  Effect.catchTag("ConfigNotFoundError", () =>
    Console.error(
      "Error: Configuration not found.\n\nRun 'domainarr init' to set up your configuration."
    ).pipe(Effect.andThen(Effect.sync(() => { process.exitCode = 1 })))
  ),
  Effect.catchTag("ConfigReadError", (e) =>
    Console.error(
      `Error: Failed to read configuration.\n\n${e.message}`
    ).pipe(Effect.andThen(Effect.sync(() => { process.exitCode = 1 })))
  ),
  Effect.catchTag("ConfigParseError", (e) =>
    Console.error(
      `Error: Invalid configuration file.\n\n${e.message}\n\nRun 'domainarr init' to reconfigure.`
    ).pipe(Effect.andThen(Effect.sync(() => { process.exitCode = 1 })))
  ),
  Effect.catchTag("ConfigWriteError", (e) =>
    Console.error(
      `Error: Failed to write configuration.\n\n${e.message}`
    ).pipe(Effect.andThen(Effect.sync(() => { process.exitCode = 1 })))
  ),
  NodeRuntime.runMain()
)
