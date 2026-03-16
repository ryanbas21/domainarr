import { Context, Effect, Option, Schema } from "effect"
import { DnsRecord, Domain, ProviderDnsRecord } from "../domain/DnsRecord.js"

// Re-export for consumers
export { ProviderDnsRecord } from "../domain/DnsRecord.js"

// The abstract interface all DNS providers implement
export class DnsProvider extends Context.Tag("@domainarr/DnsProvider")<
  DnsProvider,
  {
    // Provider identifier (e.g., "cloudflare", "porkbun")
    readonly name: string

    // List all A records
    readonly list: () => Effect.Effect<ReadonlyArray<ProviderDnsRecord>, DnsProviderErrors>

    // Find a specific record by domain
    readonly find: (domain: Domain) => Effect.Effect<Option.Option<ProviderDnsRecord>, DnsProviderErrors>

    // Add a new A record
    readonly add: (record: DnsRecord) => Effect.Effect<ProviderDnsRecord, DnsProviderErrors>

    // Remove a record by domain
    readonly remove: (domain: Domain) => Effect.Effect<void, DnsProviderErrors>

    // Add or update a record
    readonly upsert: (record: DnsRecord) => Effect.Effect<ProviderDnsRecord, DnsProviderErrors>
  }
>() {}

// Generic error for all DNS providers
export class DnsProviderError extends Schema.TaggedError<DnsProviderError>()(
  "DnsProviderError",
  {
    provider: Schema.String,
    message: Schema.String,
    code: Schema.optional(Schema.Number)
  }
) {}

export class DnsProviderAuthError extends Schema.TaggedError<DnsProviderAuthError>()(
  "DnsProviderAuthError",
  {
    provider: Schema.String,
    message: Schema.String
  }
) {}

export class DnsProviderRecordNotFoundError extends Schema.TaggedError<DnsProviderRecordNotFoundError>()(
  "DnsProviderRecordNotFoundError",
  {
    provider: Schema.String,
    domain: Schema.String
  }
) {
  override get message() {
    return `Record not found: ${this.domain}`
  }
}

// Union of all provider errors
export type DnsProviderErrors =
  | DnsProviderError
  | DnsProviderAuthError
  | DnsProviderRecordNotFoundError
