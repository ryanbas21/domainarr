# Development Guide

This guide covers setting up a development environment and contributing to Domainarr.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Adding a DNS Provider](#adding-a-dns-provider)

## Prerequisites

- Node.js 20+
- pnpm 10+
- A Pi-hole v6 instance (for integration testing)
- Cloudflare account with API access (for integration testing)

## Setup

```bash
# Clone the repository
git clone https://github.com/your-username/domainarr.git
cd domainarr

# Install dependencies
pnpm install

# Run the language service patch (required for Effect LSP support)
pnpm run prepare

# Build
pnpm build

# Type check without building
pnpm typecheck
```

## Project Structure

```
src/
├── main.ts              # Entry point, layer composition
├── cli/
│   ├── commands.ts      # @effect/cli command definitions
│   └── prompts.ts       # Interactive prompts for init
├── config/
│   └── AppConfig.ts     # Configuration loading and schema
├── domain/
│   ├── DnsRecord.ts     # Domain models (DnsRecord, Domain, IpAddress)
│   └── errors.ts        # TaggedError types
└── services/
    ├── PiholeClient.ts  # Pi-hole v6 API client
    ├── DnsProvider.ts   # DNS provider interface
    ├── DomainManager.ts # Orchestration service
    ├── BackupService.ts # Backup/restore service
    └── providers/
        ├── index.ts
        └── cloudflare.ts
```

## Development Workflow

### Running in Development

```bash
# Run without building (uses tsx)
pnpm dev -- <command> [args]

# Examples
pnpm dev -- list
pnpm dev -- add test.example.com 192.168.1.50
```

### Building

```bash
# Full build
pnpm build

# Type check only (faster feedback)
pnpm typecheck
```

### Effect Language Service

The project uses the Effect Language Service for enhanced LSP support. After installing dependencies, run:

```bash
pnpm run prepare
```

This patches TypeScript to enable Effect-specific diagnostics:

- **TS39**: Prefer `mapError` over `catchAll + fail`
- **TS41**: Prefer `Effect.fn` for generator functions

## Testing

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test -- --watch
```

Tests use `@effect/vitest` for Effect-aware testing.

## Adding a DNS Provider

To add a new DNS provider (e.g., Route53):

### 1. Create the Provider Module

Create `src/services/providers/route53.ts`:

```typescript
import { Effect, Layer, Option, Redacted, Schema } from "effect"
import { DnsProvider, DnsProviderError, ProviderDnsRecord } from "../DnsProvider.js"
import { DnsRecord, Domain, parseProviderDnsRecord } from "../../domain/DnsRecord.js"

// Configuration schema
export const Route53Config = Schema.Struct({
  type: Schema.Literal("route53"),
  accessKeyId: Schema.Redacted(Schema.String),
  secretAccessKey: Schema.Redacted(Schema.String),
  hostedZoneId: Schema.String
})
export type Route53Config = typeof Route53Config.Type

const PROVIDER_NAME = "route53"

// Provider factory
export const makeRoute53Provider = (config: Route53Config): Layer.Layer<DnsProvider> =>
  Layer.scoped(
    DnsProvider,
    Effect.gen(function* () {
      // Initialize AWS SDK client here

      return DnsProvider.of({
        name: PROVIDER_NAME,
        list: () => Effect.gen(function* () {
          // List A records
          return []
        }),
        find: (domain: Domain) => Effect.gen(function* () {
          // Find specific record
          return Option.none()
        }),
        add: (record: DnsRecord) => Effect.gen(function* () {
          // Create record
        }),
        remove: (domain: Domain) => Effect.gen(function* () {
          // Delete record (idempotent - succeed if not found)
        }),
        upsert: (record: DnsRecord) => Effect.gen(function* () {
          // Create or update
        })
      })
    })
  )
```

### 2. Export from Index

Add to `src/services/providers/index.ts`:

```typescript
export * from "./route53.js"
```

### 3. Add Config Schema

Update `src/config/AppConfig.ts`:

```typescript
import { Route53Config } from "../services/providers/index.js"

const DnsProviderConfig = Schema.Union(
  CloudflareConfig,
  PorkbunConfig,
  Route53Config  // Add new provider
)
```

### 4. Wire the Layer

Update `src/main.ts` to select the provider:

```typescript
const dnsProviderLayer = (() => {
  switch (config.dnsProvider.type) {
    case "cloudflare":
      return makeCloudflareProvider(config.dnsProvider)
    case "porkbun":
      return makePorkbunProvider(config.dnsProvider)
    case "route53":
      return makeRoute53Provider(config.dnsProvider)
  }
})()
```

### Provider Implementation Guidelines

1. **Make remove idempotent**: Succeed if the record doesn't exist
2. **Use retries**: Wrap operations with retry logic for transient failures
3. **Handle rate limits**: Use exponential backoff with jitter
4. **Validate responses**: Parse and validate API responses into domain types
5. **Log operations**: Use `Effect.logInfo` and `Effect.annotateLogs`
6. **Use `Effect.withSpan`**: Add spans for tracing
