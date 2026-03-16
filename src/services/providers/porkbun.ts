import { Effect, Layer, Option, Schema } from "effect"
import { DnsRecord, Domain } from "../../domain/DnsRecord.js"
import {
  DnsProvider,
  DnsProviderError,
  ProviderDnsRecord,
  type DnsProviderErrors
} from "../DnsProvider.js"

// Porkbun-specific configuration schema
export const PorkbunConfig = Schema.Struct({
  type: Schema.Literal("porkbun"),
  apiKey: Schema.Redacted(Schema.String),
  secretKey: Schema.Redacted(Schema.String),
  domain: Schema.String // Root domain (e.g., "example.com")
})
export type PorkbunConfig = typeof PorkbunConfig.Type

const PROVIDER_NAME = "porkbun"

// Create Porkbun provider layer from config
// TODO: Implement actual Porkbun API integration
export const makePorkbunProvider = (_config: PorkbunConfig) =>
  Layer.succeed(
    DnsProvider,
    DnsProvider.of({
      name: PROVIDER_NAME,

      list: (): Effect.Effect<ReadonlyArray<ProviderDnsRecord>, DnsProviderErrors> =>
        Effect.fail(
          new DnsProviderError({
            provider: PROVIDER_NAME,
            message: "Porkbun provider not yet implemented"
          })
        ),

      find: (_domain: Domain): Effect.Effect<Option.Option<ProviderDnsRecord>, DnsProviderErrors> =>
        Effect.fail(
          new DnsProviderError({
            provider: PROVIDER_NAME,
            message: "Porkbun provider not yet implemented"
          })
        ),

      add: (_record: DnsRecord): Effect.Effect<ProviderDnsRecord, DnsProviderErrors> =>
        Effect.fail(
          new DnsProviderError({
            provider: PROVIDER_NAME,
            message: "Porkbun provider not yet implemented"
          })
        ),

      remove: (_domain: Domain): Effect.Effect<void, DnsProviderErrors> =>
        Effect.fail(
          new DnsProviderError({
            provider: PROVIDER_NAME,
            message: "Porkbun provider not yet implemented"
          })
        ),

      upsert: (_record: DnsRecord): Effect.Effect<ProviderDnsRecord, DnsProviderErrors> =>
        Effect.fail(
          new DnsProviderError({
            provider: PROVIDER_NAME,
            message: "Porkbun provider not yet implemented"
          })
        )
    })
  )
