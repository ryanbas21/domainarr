import { Schema } from "effect"

// Pi-hole errors
export class PiholeAuthError extends Schema.TaggedError<PiholeAuthError>()(
  "PiholeAuthError",
  {
    message: Schema.String
  }
) {}

export class PiholeApiError extends Schema.TaggedError<PiholeApiError>()(
  "PiholeApiError",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number)
  }
) {}

export class PiholeConnectionError extends Schema.TaggedError<PiholeConnectionError>()(
  "PiholeConnectionError",
  {
    message: Schema.String,
    url: Schema.String
  }
) {}

export const PiholeError = Schema.Union(
  PiholeAuthError,
  PiholeApiError,
  PiholeConnectionError
)
export type PiholeError = typeof PiholeError.Type

// Config errors
export class ConfigNotFoundError extends Schema.TaggedError<ConfigNotFoundError>()(
  "ConfigNotFoundError",
  {
    path: Schema.String
  }
) {}

export class ConfigParseError extends Schema.TaggedError<ConfigParseError>()(
  "ConfigParseError",
  {
    message: Schema.String
  }
) {}

export class ConfigReadError extends Schema.TaggedError<ConfigReadError>()(
  "ConfigReadError",
  {
    path: Schema.String,
    message: Schema.String
  }
) {}

export class ConfigWriteError extends Schema.TaggedError<ConfigWriteError>()(
  "ConfigWriteError",
  {
    path: Schema.String,
    message: Schema.String
  }
) {}

export const ConfigError = Schema.Union(ConfigNotFoundError, ConfigParseError, ConfigReadError, ConfigWriteError)
export type ConfigError = typeof ConfigError.Type

// Backup errors
export class BackupWriteError extends Schema.TaggedError<BackupWriteError>()(
  "BackupWriteError",
  {
    path: Schema.String,
    message: Schema.String
  }
) {}

export class BackupReadError extends Schema.TaggedError<BackupReadError>()(
  "BackupReadError",
  {
    path: Schema.String,
    message: Schema.String
  }
) {}

export const BackupError = Schema.Union(BackupWriteError, BackupReadError)
export type BackupError = typeof BackupError.Type
