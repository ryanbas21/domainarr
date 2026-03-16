/**
 * Test utilities and mock services for domainarr tests.
 *
 * These helpers make it easy to test Effect services by providing
 * configurable mock implementations that can be composed into test layers.
 */
import { Effect, Layer, Option, Redacted, Ref } from "effect"
import { PiholeClient } from "../src/services/PiholeClient.js"
import { DnsProvider, type DnsProviderErrors, ProviderDnsRecord } from "../src/services/DnsProvider.js"
import { AppConfig, type AppConfigShape, type DnsProviderConfig } from "../src/config/AppConfig.js"
import { DnsRecord, type Domain, type IpAddress } from "../src/domain/DnsRecord.js"
import type { PiholeError } from "../src/domain/errors.js"

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Create a test DnsRecord with default or custom values.
 */
export const makeTestRecord = (
  domain: string = "test.example.com",
  ip: string = "192.168.1.100"
): DnsRecord =>
  DnsRecord.make({
    domain: domain as Domain,
    ip: ip as IpAddress
  })

/**
 * Create a test ProviderDnsRecord with default or custom values.
 */
export const makeTestProviderRecord = (
  domain: string = "test.example.com",
  ip: string = "192.168.1.100",
  recordId: string = "cf-record-123"
): ProviderDnsRecord =>
  ProviderDnsRecord.make({
    domain: domain as Domain,
    ip: ip as IpAddress,
    recordId
  })

/**
 * Create a test AppConfig with default or custom values.
 */
export const makeTestConfig = (
  overrides: Partial<AppConfigShape> = {}
): AppConfigShape => ({
  pihole: {
    url: "http://pihole.local",
    password: Redacted.make("test-password")
  },
  dnsProvider: {
    type: "cloudflare",
    apiToken: Redacted.make("cf-api-token"),
    zoneId: "zone-123",
    zone: "example.com"
  } as DnsProviderConfig,
  backup: {
    path: "/tmp/domainarr-test-backups"
  },
  configPath: "/tmp/domainarr-test/config.json",
  ...overrides
})

// ============================================================================
// Mock PiholeClient
// ============================================================================

export interface MockPiholeClientConfig {
  /** Records to return from list() */
  records?: DnsRecord[]
  /** Error to throw from any operation */
  error?: PiholeError
  /** Callback when add is called */
  onAdd?: (record: DnsRecord) => void
  /** Callback when remove is called */
  onRemove?: (record: DnsRecord) => void
}

/**
 * Create a mock PiholeClient layer for testing.
 *
 * @example
 * ```ts
 * const layer = makeMockPiholeClient({
 *   records: [makeTestRecord("foo.com", "1.2.3.4")],
 *   onAdd: (r) => addedRecords.push(r)
 * })
 * ```
 */
export const makeMockPiholeClient = (
  config: MockPiholeClientConfig = {}
): Layer.Layer<PiholeClient> =>
  Layer.effect(
    PiholeClient,
    Effect.gen(function* () {
      // Mutable state for tracking records
      const recordsRef = yield* Ref.make<DnsRecord[]>(config.records ?? [])

      return PiholeClient.of({
        list: () =>
          config.error
            ? Effect.fail(config.error)
            : Ref.get(recordsRef),

        add: (record) =>
          config.error
            ? Effect.fail(config.error)
            : Effect.gen(function* () {
                yield* Ref.update(recordsRef, (rs) => [...rs, record])
                config.onAdd?.(record)
              }),

        remove: (record) =>
          config.error
            ? Effect.fail(config.error)
            : Effect.gen(function* () {
                yield* Ref.update(recordsRef, (rs) =>
                  rs.filter((r) => r.domain !== record.domain)
                )
                config.onRemove?.(record)
              })
      })
    })
  )

// ============================================================================
// Mock DnsProvider
// ============================================================================

export interface MockDnsProviderConfig {
  /** Provider name */
  name?: string
  /** Records to return from list() */
  records?: ProviderDnsRecord[]
  /** Error to throw from any operation */
  error?: DnsProviderErrors
  /** Callback when add is called */
  onAdd?: (record: DnsRecord) => void
  /** Callback when remove is called */
  onRemove?: (domain: Domain) => void
  /** Callback when upsert is called */
  onUpsert?: (record: DnsRecord) => void
}

/**
 * Create a mock DnsProvider layer for testing.
 */
export const makeMockDnsProvider = (
  config: MockDnsProviderConfig = {}
): Layer.Layer<DnsProvider> =>
  Layer.effect(
    DnsProvider,
    Effect.gen(function* () {
      const recordsRef = yield* Ref.make<ProviderDnsRecord[]>(config.records ?? [])
      let nextId = 1

      return DnsProvider.of({
        name: config.name ?? "mock-provider",

        list: () =>
          config.error
            ? Effect.fail(config.error)
            : Ref.get(recordsRef),

        find: (domain) =>
          config.error
            ? Effect.fail(config.error)
            : Effect.gen(function* () {
                const records = yield* Ref.get(recordsRef)
                const found = records.find((r) => r.domain === domain)
                return found ? Option.some(found) : Option.none()
              }),

        add: (record) =>
          config.error
            ? Effect.fail(config.error)
            : Effect.gen(function* () {
                const providerRecord = ProviderDnsRecord.make({
                  domain: record.domain,
                  ip: record.ip,
                  recordId: `mock-${nextId++}`
                })
                yield* Ref.update(recordsRef, (rs) => [...rs, providerRecord])
                config.onAdd?.(record)
                return providerRecord
              }),

        remove: (domain) =>
          config.error
            ? Effect.fail(config.error)
            : Effect.gen(function* () {
                yield* Ref.update(recordsRef, (rs) =>
                  rs.filter((r) => r.domain !== domain)
                )
                config.onRemove?.(domain)
              }),

        upsert: (record) =>
          config.error
            ? Effect.fail(config.error)
            : Effect.gen(function* () {
                const records = yield* Ref.get(recordsRef)
                const existing = records.find((r) => r.domain === record.domain)

                if (existing) {
                  // Update existing
                  const updated = ProviderDnsRecord.make({
                    domain: record.domain,
                    ip: record.ip,
                    recordId: existing.recordId
                  })
                  yield* Ref.update(recordsRef, (rs) =>
                    rs.map((r) => (r.domain === record.domain ? updated : r))
                  )
                  config.onUpsert?.(record)
                  return updated
                }

                // Create new
                const providerRecord = ProviderDnsRecord.make({
                  domain: record.domain,
                  ip: record.ip,
                  recordId: `mock-${nextId++}`
                })
                yield* Ref.update(recordsRef, (rs) => [...rs, providerRecord])
                config.onUpsert?.(record)
                return providerRecord
              })
      })
    })
  )

// ============================================================================
// Mock AppConfig
// ============================================================================

/**
 * Create a mock AppConfig layer with the given config.
 */
export const makeMockAppConfig = (
  config: AppConfigShape = makeTestConfig()
): Layer.Layer<AppConfig> =>
  Layer.succeed(AppConfig, AppConfig.of(config))

// ============================================================================
// Composite Test Layers
// ============================================================================

/**
 * Create a complete test layer with all mocked services.
 */
export const makeTestLayer = (options: {
  pihole?: MockPiholeClientConfig
  dnsProvider?: MockDnsProviderConfig
  config?: AppConfigShape
} = {}): Layer.Layer<PiholeClient | DnsProvider | AppConfig> =>
  Layer.mergeAll(
    makeMockPiholeClient(options.pihole),
    makeMockDnsProvider(options.dnsProvider),
    makeMockAppConfig(options.config)
  )
