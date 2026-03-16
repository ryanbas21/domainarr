import { Prompt } from "@effect/cli"
import { Console, Effect } from "effect"
import * as Os from "node:os"
import * as Path from "node:path"
import type { AppConfigShape, DnsProviderConfig } from "../config/AppConfig.js"

// Default backup path in user's home directory
const DEFAULT_BACKUP_PATH = Path.join(Os.homedir(), ".local", "share", "domainarr", "backups")

// Validation helpers
const validateUrl = (value: string) => {
  try {
    new URL(value)
    return Effect.succeed(value)
  } catch {
    return Effect.fail("Must be a valid URL (e.g., http://192.168.1.1)")
  }
}

const validateNonEmpty = (field: string) => (value: string) =>
  value.trim().length > 0
    ? Effect.succeed(value.trim())
    : Effect.fail(`${field} cannot be empty`)

const validatePath = (value: string) =>
  value.startsWith("/")
    ? Effect.succeed(value)
    : Effect.fail("Path must be absolute (start with /)")

// Prompt for Cloudflare-specific config
const promptCloudflareConfig = Effect.gen(function* () {
  yield* Console.log("\nCloudflare Configuration")
  yield* Console.log("─".repeat(40))

  const apiToken = yield* Prompt.password({
    message: "Cloudflare API token"
  })

  const zone = yield* Prompt.text({
    message: "Cloudflare zone (e.g., example.com)",
    validate: validateNonEmpty("Zone")
  })

  const zoneId = yield* Prompt.text({
    message: "Cloudflare zone ID",
    validate: validateNonEmpty("Zone ID")
  })

  return {
    type: "cloudflare" as const,
    apiToken,
    zone,
    zoneId
  } satisfies DnsProviderConfig
})

// Prompt for Porkbun-specific config
const promptPorkbunConfig = Effect.gen(function* () {
  yield* Console.log("\nPorkbun Configuration")
  yield* Console.log("─".repeat(40))

  const apiKey = yield* Prompt.password({
    message: "Porkbun API key"
  })

  const secretKey = yield* Prompt.password({
    message: "Porkbun secret key"
  })

  const domain = yield* Prompt.text({
    message: "Root domain (e.g., example.com)",
    validate: validateNonEmpty("Domain")
  })

  return {
    type: "porkbun" as const,
    apiKey,
    secretKey,
    domain
  } satisfies DnsProviderConfig
})

export const promptForConfig = Effect.gen(function* () {
  yield* Console.log("Pi-hole Configuration")
  yield* Console.log("─".repeat(40))

  const piholeUrl = yield* Prompt.text({
    message: "Pi-hole URL",
    default: "http://192.168.1.1",
    validate: validateUrl
  })

  const piholePassword = yield* Prompt.password({
    message: "Pi-hole admin password"
  })

  // DNS Provider selection
  yield* Console.log("\nDNS Provider")
  yield* Console.log("─".repeat(40))

  const providerChoice = yield* Prompt.select({
    message: "Select DNS provider",
    choices: [
      { title: "Cloudflare", value: "cloudflare" },
      { title: "Porkbun", value: "porkbun" }
    ]
  })

  const dnsProvider: DnsProviderConfig = yield* (
    providerChoice === "cloudflare"
      ? promptCloudflareConfig
      : promptPorkbunConfig
  )

  yield* Console.log("\nBackup Configuration")
  yield* Console.log("─".repeat(40))

  const backupPath = yield* Prompt.text({
    message: "Backup directory",
    default: DEFAULT_BACKUP_PATH,
    validate: validatePath
  })

  return {
    pihole: {
      url: piholeUrl,
      password: piholePassword
    },
    dnsProvider,
    backup: {
      path: backupPath
    }
  } satisfies Omit<AppConfigShape, "configPath">
})
