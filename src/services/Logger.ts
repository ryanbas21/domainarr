import { HashMap, Layer, Logger, LogLevel } from "effect"

/**
 * CLI-friendly logger that formats output for terminal display.
 * Supports log levels and structured annotations.
 */
export const CliLogger = Logger.make(({ logLevel, message, annotations, date }) => {
  const level =
    logLevel._tag === "Error" ? "ERROR" :
    logLevel._tag === "Warning" ? "WARN" :
    logLevel._tag === "Info" ? "INFO" :
    logLevel._tag === "Debug" ? "DEBUG" :
    "TRACE"

  // Format annotations if present (HashMap to array of entries)
  const annotationEntries = HashMap.toEntries(annotations)
  const annotationStr = annotationEntries.length > 0
    ? ` [${annotationEntries.map(([k, v]) => `${k}=${v}`).join(", ")}]`
    : ""

  // Only show timestamp for debug/trace levels
  const showTimestamp = logLevel._tag === "Debug" || logLevel._tag === "Trace"
  const timestamp = showTimestamp ? `${date.toISOString()} ` : ""

  // Color codes for terminal
  const levelColor =
    logLevel._tag === "Error" ? "\x1b[31m" :  // Red
    logLevel._tag === "Warning" ? "\x1b[33m" : // Yellow
    logLevel._tag === "Info" ? "\x1b[36m" :    // Cyan
    logLevel._tag === "Debug" ? "\x1b[90m" :   // Gray
    "\x1b[90m"                                  // Gray for trace
  const reset = "\x1b[0m"

  globalThis.console.log(`${timestamp}${levelColor}[${level}]${reset} ${message}${annotationStr}`)
})

/**
 * Layer that replaces the default logger with our CLI-friendly logger.
 */
export const CliLoggerLayer = Logger.replace(Logger.defaultLogger, CliLogger)

/**
 * Minimum log level layer - use to filter out debug/trace in production.
 */
export const MinimumLogLevelInfo = Logger.minimumLogLevel(LogLevel.Info)
export const MinimumLogLevelDebug = Logger.minimumLogLevel(LogLevel.Debug)

/**
 * Combined layer for CLI logging at Info level (default for production).
 */
export const CliLoggerLive = Layer.mergeAll(CliLoggerLayer, MinimumLogLevelInfo)

/**
 * Combined layer for CLI logging at Debug level (for development/debugging).
 */
export const CliLoggerDebug = Layer.mergeAll(CliLoggerLayer, MinimumLogLevelDebug)
