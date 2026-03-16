# Architecture

This document describes the internal architecture of Domainarr.

## Table of Contents

- [Overview](#overview)
- [Layer Composition](#layer-composition)
- [Domain Layer](#domain-layer)
- [Services](#services)
- [Configuration](#configuration)
- [Effect Patterns](#effect-patterns)

## Overview

Domainarr uses [Effect](https://effect.website) TypeScript with a service-oriented architecture. Services are composed using Effect's Layer system for dependency injection.

```
┌─────────────────────────────────────────────────────┐
│                     CLI Layer                        │
│                  (@effect/cli)                       │
├─────────────────────────────────────────────────────┤
│              Orchestration Services                  │
│         DomainManager  │  BackupService             │
├─────────────────────────────────────────────────────┤
│                Provider Services                     │
│          PiholeClient  │  DnsProvider               │
│                        │  (cloudflare/porkbun)      │
├─────────────────────────────────────────────────────┤
│                  Configuration                       │
│                    AppConfig                         │
├─────────────────────────────────────────────────────┤
│                Platform Services                     │
│    HttpClient  │  FileSystem  │  Path  │  Terminal  │
└─────────────────────────────────────────────────────┘
```

## Layer Composition

Services are wired in `src/main.ts` using Effect's Layer system:

```typescript
// Platform provides HttpClient, FileSystem, Path, etc.
NodeContext.layer

// AppConfig reads from ~/.config/domainarr/config.json
AppConfig.layer  // depends on FileSystem

// Clients connect to external services
PiholeClient.layer      // depends on AppConfig, HttpClient
DnsProvider (cloudflare) // depends on AppConfig

// Orchestration services coordinate multiple providers
DomainManager.layer  // depends on PiholeClient, DnsProvider
BackupService.layer  // depends on PiholeClient, DnsProvider, FileSystem, Path
```

The full layer graph is composed with `Layer.provide` and `Layer.merge`:

```typescript
const MainLayer = MainLive.pipe(
  Layer.provide(DomainManager.layer),
  Layer.provide(BackupService.layer),
  Layer.provide(PiholeClient.layer),
  Layer.provide(dnsProviderLayer), // dynamically selected
  Layer.provide(AppConfig.layer),
  Layer.provide(NodeContext.layer),
  Layer.provide(NodeHttpClient.layerUndici)
)
```

## Domain Layer

### `src/domain/DnsRecord.ts`

Core domain models with branded types for type safety:

```typescript
// Branded types prevent mixing up strings
type Domain = string & Brand<"Domain">
type IpAddress = string & Brand<"IpAddress">

// DnsRecord is a Schema.Class for validation + serialization
class DnsRecord extends Schema.Class<DnsRecord>("DnsRecord")({
  domain: Domain,
  ip: IpAddress
}) {
  get piholeEncoded(): string {
    return encodeURIComponent(`${this.ip} ${this.domain}`)
  }
}
```

### `src/domain/errors.ts`

Tagged errors for type-safe error handling:

```typescript
class PiholeAuthError extends Schema.TaggedError<PiholeAuthError>()(
  "PiholeAuthError",
  { message: Schema.String }
) {}

class PiholeApiError extends Schema.TaggedError<PiholeApiError>()(
  "PiholeApiError",
  { message: Schema.String, status: Schema.optional(Schema.Number) }
) {}
```

## Services

### PiholeClient (`src/services/PiholeClient.ts`)

Pi-hole v6 REST API client with session-based authentication.

**Key implementation details:**

- Session management using `Ref<Option<PiholeSession>>` for fiber-safe state
- Automatic re-authentication on 401 responses
- Retry with exponential backoff + jitter for transient errors
- HTTP timeout handling

**Authentication flow:**

1. POST `/api/auth` with password
2. Receive `sid` (session ID) and `csrf` token
3. Include `Cookie: sid=...` and `X-CSRF-Token: ...` on subsequent requests

### DnsProvider (`src/services/DnsProvider.ts`)

Abstract interface for DNS providers. Currently implemented:

- **Cloudflare** (`src/services/providers/cloudflare.ts`)

**Interface:**

```typescript
interface DnsProvider {
  name: string
  list: () => Effect<ProviderDnsRecord[], DnsProviderErrors>
  find: (domain: Domain) => Effect<Option<ProviderDnsRecord>, DnsProviderErrors>
  add: (record: DnsRecord) => Effect<ProviderDnsRecord, DnsProviderErrors>
  remove: (domain: Domain) => Effect<void, DnsProviderErrors>
  upsert: (record: DnsRecord) => Effect<ProviderDnsRecord, DnsProviderErrors>
}
```

### DomainManager (`src/services/DomainManager.ts`)

Orchestration service that coordinates Pi-hole and DNS provider operations.

**Operations:**

- `list()` - Merges records from both providers, showing sync status
- `add(record)` - Adds to both providers (best-effort, reports individual failures)
- `remove(domain)` - Removes from both providers
- `sync()` - Pushes all Pi-hole records to DNS provider (Pi-hole is source of truth)

### BackupService (`src/services/BackupService.ts`)

Filesystem-based backup and restore.

**Backup format:**

```json
{
  "version": 1,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "pihole": [{ "domain": "...", "ip": "..." }],
  "dnsProvider": [{ "domain": "...", "ip": "...", "recordId": "..." }]
}
```

## Configuration

### AppConfig (`src/config/AppConfig.ts`)

Loads configuration from `~/.config/domainarr/config.json`.

**Schema:**

```typescript
const AppConfigSchema = Schema.Struct({
  pihole: Schema.Struct({
    url: Schema.String,
    password: Schema.Redacted(Schema.String)
  }),
  dnsProvider: Schema.Union(
    CloudflareConfig,  // { type: "cloudflare", apiToken, zoneId, zone }
    PorkbunConfig      // { type: "porkbun", ... }
  ),
  backup: Schema.Struct({
    path: Schema.String
  })
})
```

**Provider selection:**

The `dnsProvider.type` field discriminates which provider implementation to use. The layer is selected dynamically at runtime:

```typescript
const dnsProviderLayer = config.dnsProvider.type === "cloudflare"
  ? makeCloudflareProvider(config.dnsProvider)
  : makePorkbunProvider(config.dnsProvider)
```

## Effect Patterns

### Context.Tag for Dependency Injection

Services are defined as tags and implemented via layers:

```typescript
class PiholeClient extends Context.Tag("@domainarr/PiholeClient")<
  PiholeClient,
  { readonly list: () => Effect<...>, ... }
>() {
  static readonly layer = Layer.effect(PiholeClient, Effect.gen(function* () {
    // implementation
  }))
}
```

### Effect.fn for Call-Site Tracing

`Effect.fn` enables better stack traces by capturing the call site:

```typescript
const list = Effect.fn("DomainManager.list")(function* () {
  // implementation
})
```

### Effect.either for Error Preservation

When you need to handle errors without losing information:

```typescript
const result = yield* someOperation().pipe(Effect.either)

if (Either.isLeft(result)) {
  yield* Effect.logWarning(`Failed: ${result.left.message}`)
}

const value = Either.isRight(result) ? result.right : fallback
```

### Schema.TaggedError for Typed Errors

Errors extend `Schema.TaggedError` for pattern matching with `Effect.catchTag`:

```typescript
yield* operation.pipe(
  Effect.catchTag("PiholeAuthError", (e) => ...),
  Effect.catchTag("PiholeApiError", (e) => ...)
)
```

### Retry with Schedule

Transient errors are retried with exponential backoff:

```typescript
const retrySchedule = Schedule.exponential(Duration.millis(500)).pipe(
  Schedule.jittered,
  Schedule.either(Schedule.recurs(2)),  // max 3 attempts total
  Schedule.upTo(Duration.seconds(5))
)

effect.pipe(
  Effect.retry({
    schedule: retrySchedule,
    while: isRetryable  // only retry transient errors
  })
)
```
