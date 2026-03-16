# Domainarr

DNS sync CLI for managing Pi-hole and Cloudflare DNS records together.

> **Documentation**: See `README.md` for user docs, `docs/` for technical details.

## Quick Orientation

- **Framework**: Effect TypeScript with service-oriented architecture
- **Entry point**: `src/main.ts` (layer composition + CLI)
- **Services**: `src/services/` (PiholeClient, DnsProvider, DomainManager, BackupService)
- **Domain**: `src/domain/` (DnsRecord, errors)
- **Config**: `~/.config/domainarr/config.json`

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Layer composition, CLI entry |
| `src/services/PiholeClient.ts` | Pi-hole v6 API client with session auth |
| `src/services/providers/cloudflare.ts` | Cloudflare DNS provider |
| `src/services/DomainManager.ts` | Orchestrates both providers |
| `src/services/DnsProvider.ts` | Provider interface + error types |
| `src/domain/DnsRecord.ts` | Domain models with branded types |
| `src/domain/errors.ts` | TaggedError types |

## Effect Patterns

```typescript
// Services use Context.Tag
class MyService extends Context.Tag("@domainarr/MyService")<MyService, {...}>() {
  static readonly layer = Layer.effect(MyService, Effect.gen(function* () { ... }))
}

// Errors use Schema.TaggedError
class MyError extends Schema.TaggedError<MyError>()("MyError", { message: Schema.String }) {}

// Use Effect.fn for tracing
const myOp = Effect.fn("Service.operation")(function* () { ... })

// Retry transient errors
Schedule.exponential(Duration.millis(500)).pipe(Schedule.jittered, ...)

// Session state with Ref
const sessionRef = yield* Ref.make<Option<Session>>(Option.none())
```

## Conventions

- **Idempotent removes**: `remove` operations succeed if record doesn't exist
- **Best-effort sync**: Operations report per-provider success/failure
- **Pi-hole is source of truth**: `sync` pushes Pi-hole → DNS provider
- **Retry transient errors**: 5xx, 429, connection errors; not 4xx client errors
- **401 handling**: Clear session, re-authenticate, retry

## Provider Configuration

The `dnsProvider` field uses discriminated union:

```json
{
  "dnsProvider": {
    "type": "cloudflare",  // discriminator
    "apiToken": "...",
    "zoneId": "...",
    "zone": "example.com"
  }
}
```

## Pi-hole v6 API

Session-based auth:
1. POST `/api/auth` with password → `{ session: { sid, csrf } }`
2. Headers: `Cookie: sid=...`, `X-CSRF-Token: ...`
3. DNS: `/api/config/dns/hosts/{encoded}` where `encoded = encodeURIComponent("IP DOMAIN")`
