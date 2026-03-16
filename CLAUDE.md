# Domainarr

DNS sync CLI for managing Pi-hole and Cloudflare DNS records together.

## Architecture

This project uses Effect TypeScript with a service-oriented architecture:

### Domain Layer (`src/domain/`)
- `DnsRecord.ts` - Core domain models with branded types (Domain, IpAddress)
- `errors.ts` - TaggedError types for type-safe error handling

### Services (`src/services/`)
- `PiholeClient.ts` - Pi-hole v6 REST API client (session-based auth with Ref state)
- `DnsProvider.ts` - Abstract DNS provider interface
- `providers/cloudflare.ts` - Cloudflare implementation using official SDK
- `providers/porkbun.ts` - Porkbun implementation (stub)
- `DomainManager.ts` - Orchestration service (coordinates Pi-hole + DNS provider)
- `BackupService.ts` - Backup/restore to filesystem
- `Logger.ts` - CLI-friendly logger with colored output

### Configuration (`src/config/`)
- `AppConfig.ts` - Configuration service loading from `~/.config/domainarr/config.json`

### CLI (`src/cli/`)
- `commands.ts` - @effect/cli command definitions
- `prompts.ts` - Interactive prompts for `domainarr init`

## Layer Composition

Services are wired using Effect's Layer system in `src/main.ts`:
```
NodeContext + NodeHttpClient (Platform)
        ↓
    AppConfig (needs FileSystem)
        ↓
PiholeClient + DnsProvider (need Config + Http)
        ↓
DomainManager + BackupService (need Clients)
```

## Commands

- `domainarr add <domain> <ip>` - Add DNS record to both providers
- `domainarr remove <domain>` - Remove from both providers
- `domainarr list` - List all records with sync status
- `domainarr sync` - Sync Pi-hole → DNS provider (Pi-hole is source of truth)
- `domainarr backup` - Create backup to configured path
- `domainarr restore [file]` - Restore from backup
- `domainarr init` - Interactive setup wizard

## Development

```bash
pnpm install
pnpm build      # Compile TypeScript
pnpm typecheck  # Type check without emit
```

## Effect Patterns Used

- `Context.Tag` for dependency injection
- `Schema.Class` for domain models with validation
- `Schema.TaggedError` for typed errors
- `Effect.fn` for call-site tracing (shows in error traces)
- `Layer.effect` / `Layer.scoped` for service construction
- `Layer.provide` / `Layer.merge` for dependency wiring
- `Effect.catchTag` for pattern matching on errors
- `Effect.acquireRelease` for resource lifecycle management
- `Ref` for fiber-safe mutable state (session management)
- `Schedule.exponential` with `Schedule.jittered` for retry with backoff

## Configuration

Config is stored at `~/.config/domainarr/config.json`:
```json
{
  "pihole": {
    "url": "http://pihole.local",
    "password": "your-password"
  },
  "dnsProvider": {
    "type": "cloudflare",
    "apiToken": "your-api-token",
    "zoneId": "your-zone-id",
    "zone": "example.com"
  },
  "backup": {
    "path": "/path/to/backups"
  }
}
```

The `dnsProvider` field supports multiple provider types via discriminated union:
- `type: "cloudflare"` - Cloudflare DNS
- `type: "porkbun"` - Porkbun DNS (not yet implemented)

## Pi-hole v6 API

Uses session-based authentication:
1. POST `/api/auth` with password → returns SID + CSRF token
2. Include `Cookie: sid=...` and `X-CSRF-Token: ...` headers
3. DNS records at `/api/config/dns/hosts/{encoded}` (PUT to add, DELETE to remove)

Encoded format: `encodeURIComponent("IP DOMAIN")`
