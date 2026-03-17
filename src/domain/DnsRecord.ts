import { Effect, ParseResult, Schema } from "effect"

// Branded types for type safety
export const Domain = Schema.String.pipe(
  Schema.pattern(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/),
  Schema.brand("Domain")
)
export type Domain = typeof Domain.Type

// Validates IPv4 addresses with proper octet range checking (0-255)
export const IpAddress = Schema.String.pipe(
  Schema.pattern(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/),
  Schema.brand("IpAddress")
)
export type IpAddress = typeof IpAddress.Type

// Core DNS record - used for both Pi-hole and Cloudflare
export class DnsRecord extends Schema.Class<DnsRecord>("DnsRecord")({
  domain: Domain,
  ip: IpAddress
}) {
  // URL-encoded format for Pi-hole API: "192.168.1.50 homarr.basmajian.xyz"
  get piholeEncoded(): string {
    return encodeURIComponent(`${this.ip} ${this.domain}`)
  }
}

// Generic DNS record from external provider (for backups)
export class ProviderDnsRecord extends Schema.Class<ProviderDnsRecord>("ProviderDnsRecord")({
  domain: Domain,
  ip: IpAddress,
  recordId: Schema.String
}) {}

/**
 * Safely parse domain and IP strings from external APIs.
 * Returns Effect that fails with ParseError if validation fails.
 */
export const parseDnsRecord = (
  domain: string,
  ip: string
): Effect.Effect<DnsRecord, ParseResult.ParseError> =>
  Effect.all({
    domain: Schema.decode(Domain)(domain),
    ip: Schema.decode(IpAddress)(ip)
  }).pipe(Effect.map(({ domain, ip }) => DnsRecord.make({ domain, ip })))

/**
 * Safely parse a ProviderDnsRecord from external API data.
 */
export const parseProviderDnsRecord = (
  domain: string,
  ip: string,
  recordId: string
): Effect.Effect<ProviderDnsRecord, ParseResult.ParseError> =>
  Effect.all({
    domain: Schema.decode(Domain)(domain),
    ip: Schema.decode(IpAddress)(ip)
  }).pipe(Effect.map(({ domain, ip }) => ProviderDnsRecord.make({ domain, ip, recordId })))

// Backup file format
export class DnsBackup extends Schema.Class<DnsBackup>("DnsBackup")({
  version: Schema.Literal(1),
  timestamp: Schema.Date,
  pihole: Schema.Array(DnsRecord),
  dnsProvider: Schema.Array(ProviderDnsRecord)
}) {
  static Json = Schema.parseJson(DnsBackup)

  static empty() {
    return DnsBackup.make({
      version: 1,
      timestamp: new Date(),
      pihole: [],
      dnsProvider: []
    })
  }
}
