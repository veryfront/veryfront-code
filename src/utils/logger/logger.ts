import { getEnv, getHostEnv } from "#veryfront/platform/compat/process/env.ts";
import { isStdoutTTY } from "#veryfront/platform/compat/process/lifecycle.ts";
import { isTruthyEnvValue } from "../constants/env.ts";
import { RUNTIME_VERSION } from "../version.ts";
import {
  ANSI,
  colorize,
  formatContextText,
  formatTimestamp,
  LEVEL_COLORS,
  LEVEL_GLYPHS,
  type LogLevelName,
  padTag,
  type SerializedError,
  serializeError,
} from "./core.ts";
import {
  REDACTED,
  redactForSerialization,
  redactSensitive,
  sanitizeSerializedError,
  sanitizeUrlCredentials,
} from "./redact.ts";
import { stringifyRedactedJson } from "./serialization.ts";

const apply = Reflect.apply;
const arrayPush = Array.prototype.push;
const arrayIsArray = Array.isArray;
const NativeConsole = console;
const NativeDate = Date;
const dateToISOString = Date.prototype.toISOString;
const NativePerformance = performance;
const performanceNow = Performance.prototype.now;
const numberRound = Math.round;
const objectCreate = Object.create;
const objectGetPrototypeOf = Object.getPrototypeOf;
const NativeSet = Set;
const setAdd = Set.prototype.add;
const setClear = Set.prototype.clear;
const setDelete = Set.prototype.delete;
const setValues = Set.prototype.values;
const setIteratorNext = objectGetPrototypeOf(new NativeSet().values()).next;
const stringToLowerCase = String.prototype.toLowerCase;
const stringToUpperCase = String.prototype.toUpperCase;

function readPerformanceNow(): number {
  try {
    return apply(performanceNow, NativePerformance, []) as number;
  } catch {
    return 0;
  }
}

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}
Object.freeze(LogLevel);

export type LogFormat = "text" | "json";

/**
 * Structured log entry for JSON output.
 * Fields are designed for easy Grafana/Loki filtering.
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevelName;
  service: string;
  veryfrontVersion: string;
  message: string;
  // Component that produced this log entry (e.g., "config", "cors", "discovery")
  component?: string;
  // Optional structured context
  context?: Record<string, unknown>;
  // Error details if applicable
  error?: SerializedError;
  // Request context (when available)
  /** @deprecated Use `request_id` instead. Kept for Grafana dashboard transition. Planned removal after Grafana dashboard migration is complete. */
  requestId?: string;
  /** @deprecated Use `trace_id` instead. Kept for Grafana dashboard transition. Planned removal after Grafana dashboard migration is complete. */
  traceId?: string;
  /** @deprecated Use `span_id` instead. Kept for Grafana dashboard transition. Planned removal after Grafana dashboard migration is complete. */
  spanId?: string;
  /** @deprecated Use `project_slug` instead. Kept for Grafana dashboard transition. Planned removal after Grafana dashboard migration is complete. */
  projectSlug?: string;
  // Standard fields for Loki filtering (snake_case)
  request_id?: string;
  trace_id?: string;
  span_id?: string;
  project_slug?: string;
  request_url?: string;
  domain?: string;
  project_id?: string;
  process_role?: string;
  release_id?: string;
  branch_id?: string;
  branch_name?: string;
  run_execution_id?: string;
  run_id?: string;
  agent_id?: string;
  thread_id?: string;
  schedule_id?: string;
  schedule_name?: string;
  tool_name?: string;
  tool_call_id?: string;
  batch_id?: string;
  run_target?: string;
  task?: string;
  event_kind?: string;
  user_visible?: string;
  user_id?: string;
  conversation_id?: string;
  /** @deprecated Use `process_role` instead. Kept for dashboard transition. */
  processRole?: string;
  /** @deprecated Use `user_id` instead. Kept for Grafana dashboard transition. */
  userId?: string;
  /** @deprecated Use `conversation_id` instead. Kept for Grafana dashboard transition. */
  conversationId?: string;
  // Duration for timed operations
  /** @deprecated Use `duration_ms` instead. Kept for Grafana dashboard transition. Planned removal after Grafana dashboard migration is complete. */
  durationMs?: number;
  duration_ms?: number;
}

/** Public API contract for logger. */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  time<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /**
   * Create a child logger with additional context bound to all log entries.
   */
  child(context: Record<string, unknown>): Logger;
  /**
   * Create a component-scoped logger. The component name is included as a
   * structured `component` field in JSON output and rendered as `[component]`
   * in text output.
   */
  component(name: string): Logger;
}

type LoggerConfig = {
  level: LogLevel;
  format: LogFormat;
  /** Output preset: "server" emits timestamp+tag prefix; "cli" emits 2-space indent + glyph only. */
  preset: "cli" | "server";
};

type ConsoleLoggerOptions = {
  injectTraceContext?: boolean;
};

export type LogRecordEmitter = (entry: LogEntry) => void;

// ---- Config helpers (must be declared before the eager init below) ----

const LOG_LEVEL_MAP: Readonly<Record<string, LogLevel>> = {
  DEBUG: LogLevel.DEBUG,
  INFO: LogLevel.INFO,
  WARN: LogLevel.WARN,
  ERROR: LogLevel.ERROR,
} as const;

function parseLogLevel(levelString: string | undefined): LogLevel | undefined {
  if (!levelString) return undefined;
  return LOG_LEVEL_MAP[apply(stringToUpperCase, levelString, []) as string];
}

/**
 * Determine the log level based on environment variables.
 * Exported for testing purposes.
 * @internal
 */
export function getDefaultLevel(
  envLevel: string | undefined = getHostEnv("LOG_LEVEL"),
  debugFlag: string | undefined = getHostEnv("VERYFRONT_DEBUG"),
): LogLevel {
  const parsedLevel = parseLogLevel(envLevel);
  if (parsedLevel !== undefined) return parsedLevel;
  if (isTruthyEnvValue(debugFlag)) return LogLevel.DEBUG;
  return LogLevel.INFO;
}

/**
 * Determine log format from environment.
 * Defaults to JSON in production for Grafana compatibility.
 */
function getDefaultFormat(
  envFormat: string | undefined = getHostEnv("LOG_FORMAT"),
  envMode: string | undefined = getHostEnv("NODE_ENV"),
): LogFormat {
  if (envFormat === "json" || envFormat === "text") return envFormat;
  return envMode === "production" ? "json" : "text";
}

// ---- Lazy config resolution ----

/**
 * Resolved lazily on first use (not at module load) to avoid a module
 * initialization-order hazard: reading env during load can re-enter the
 * platform env module while it is still initializing (TDZ crash in worker
 * contexts). Resolution reads host process env vars directly so an active
 * per-request project env overlay cannot change process-level logger config.
 */
let loggerConfig: LoggerConfig | null = null;

let legacyLogRecordEmitter: LogRecordEmitter | null = null;
const logRecordSubscribers = new NativeSet<LogRecordEmitter>();

/**
 * Re-read logger configuration from environment variables.
 * Call after loading .env files so the logger picks up any overrides.
 * The active preset (cli/server) is preserved across refreshes.
 */
export function refreshLoggerConfig(): void {
  loggerConfig = {
    level: getDefaultLevel(),
    format: getDefaultFormat(),
    preset: loggerConfig?.preset ?? "server",
  };
}

/**
 * Switch the text output format between server-style (timestamp + tag prefix)
 * and CLI-style (2-space indent + glyph only, no timestamp or tag). JSON output
 * is unaffected by this setting. Call before any framework code runs in CLI
 * entry points so framework messages render in the CLI's visual language.
 */
export function setLoggerPreset(preset: "cli" | "server"): void {
  const config = resolveLoggerConfig();
  loggerConfig = { ...config, preset };
}

/**
 * Override the active log level without re-reading environment variables.
 * Use when a verbosity flag (--verbose, --quiet) has been parsed and its effect
 * needs to propagate to all loggers immediately.
 */
export function setLogLevel(level: LogLevel): void {
  const config = resolveLoggerConfig();
  loggerConfig = { ...config, level };
}

/** @internal Alias kept for tests. */
export const __resetLoggerConfigForTests = refreshLoggerConfig;

/** Register a process-level structured log emitter, for example an OTel bridge. */
export function __registerLogRecordEmitter(emitter: LogRecordEmitter | null): void {
  legacyLogRecordEmitter = emitter;
}

/** Subscribe to process-level structured log records. Returns an unregister function. */
export function __subscribeLogRecordEmitter(emitter: LogRecordEmitter): () => void {
  apply(setAdd, logRecordSubscribers, [emitter]);
  return () => {
    apply(setDelete, logRecordSubscribers, [emitter]);
  };
}

/** Reset the process-level structured log emitter. Only intended for tests. */
export function __resetLogRecordEmitterForTests(): void {
  legacyLogRecordEmitter = null;
  apply(setClear, logRecordSubscribers, []);
}

function resolveLoggerConfig(): LoggerConfig {
  if (loggerConfig === null) {
    loggerConfig = {
      level: getDefaultLevel(),
      format: getDefaultFormat(),
      preset: "server",
    };
  }
  return loggerConfig;
}

function sanitizeLogString(value: unknown, fallback: string): string {
  try {
    return sanitizeUrlCredentials(typeof value === "string" ? value : String(value));
  } catch {
    return fallback;
  }
}

function currentIsoTimestamp(): string {
  return apply(dateToISOString, new NativeDate(), []) as string;
}

function snapshotLogContext(context: unknown): Record<string, unknown> {
  try {
    const snapshot = redactForSerialization(context);
    return typeof snapshot === "object" && snapshot !== null && !arrayIsArray(snapshot)
      ? snapshot as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/**
 * Extract context from variadic args.
 * First object argument becomes context, errors are handled specially.
 */
function extractContext(
  args: unknown[],
): { context?: Record<string, unknown>; error?: LogEntry["error"] } {
  let context: Record<string, unknown> | undefined;
  let error: LogEntry["error"] | undefined;

  for (const arg of args) {
    try {
      if (arg instanceof Error) {
        error = serializeError(arg);
        continue;
      }
      if (typeof arg === "object" && arg !== null && !arrayIsArray(arg)) {
        const contextArg = arg as Record<string, unknown>;
        if (contextArg.error instanceof Error) {
          const { error: contextError, ...rest } = contextArg;
          error = serializeError(contextError);
          if (Object.keys(rest).length > 0) {
            context = { ...context, ...rest };
          }
          continue;
        }
        context = { ...context, ...contextArg };
      }
    } catch {
      // Logging accepts application-owned objects. Ignore an unreadable value
      // rather than allowing proxy traps or getters to break the caller.
    }
  }

  return { context, error };
}

const TAG_COLORS: Record<string, string> = {
  CLI: ANSI.green,
  SERVER: ANSI.blue,
  RENDERER: ANSI.magenta,
  BUNDLER: ANSI.yellow,
  AGENT: ANSI.cyan,
  PROXY: ANSI.cyan,
  VERYFRONT: ANSI.cyan,
};

/** Glyphs used in CLI preset mode — deliberately different from server glyphs. */
const CLI_LEVEL_GLYPHS: Record<LogLevelName, string> = {
  debug: "·",
  info: "●",
  warn: "!",
  error: "✗",
};

function isTty(): boolean {
  try {
    return isStdoutTTY();
  } catch (_) {
    /* expected: TTY detection may fail in restricted environments */
    return false;
  }
}

function shouldUseColor(): boolean {
  const noColor = getEnv("NO_COLOR");
  const forceColor = getEnv("FORCE_COLOR");
  const logColor = getEnv("LOG_COLOR");

  if (forceColor === "0" || logColor === "0") return false;
  if (noColor !== undefined) return false;
  if (getEnv("CI") !== undefined) return false;
  if (forceColor || logColor === "1" || logColor === "true") return true;

  return isTty();
}

function extractToEntryField(
  entry: LogEntry,
  context: Record<string, unknown>,
  key: keyof LogEntry,
  coerce: (value: unknown) => LogEntry[keyof LogEntry],
): void {
  if (!(key in context)) return;
  entry[key] = coerce(context[key]) as never;
  delete context[key];
}

function extractAliasToEntryField(
  entry: LogEntry,
  context: Record<string, unknown>,
  sourceKey: string,
  targetKey: keyof LogEntry,
  coerce: (value: unknown) => LogEntry[keyof LogEntry],
): void {
  if (entry[targetKey] !== undefined || !(sourceKey in context)) return;
  entry[targetKey] = coerce(context[sourceKey]) as never;
  delete context[sourceKey];
}

function sanitizeStringFieldValue(value: unknown): string {
  return sanitizeUrlCredentials(String(value));
}

function createFallbackLogEntry(entry: LogEntry): Record<string, unknown> {
  const fallback = objectCreate(null) as Record<string, unknown>;
  fallback.timestamp = entry.timestamp;
  fallback.level = entry.level;
  fallback.service = entry.service;
  fallback.veryfrontVersion = entry.veryfrontVersion;
  fallback.message = entry.message;
  if (entry.component !== undefined) fallback.component = entry.component;
  const context = objectCreate(null) as Record<string, string>;
  context.unserializable_context = REDACTED;
  fallback.context = context;
  return fallback;
}

/**
 * Serialize a log entry without letting caller-controlled values or inherited
 * `toJSON` hooks escape the logging boundary. The redacted snapshot normalizes
 * BigInt and deliberate serializers first, then shadows inherited hooks on
 * every owned object and array before native JSON serialization.
 */
function stringifyLogEntry(entry: LogEntry): string {
  return stringifyRedactedJson(entry, createFallbackLogEntry(entry));
}

class ConsoleLogger implements Logger {
  private boundContext: Record<string, unknown>;
  private componentName?: string;

  constructor(
    private prefix: string,
    boundContext?: Record<string, unknown>,
    componentName?: string,
    private readonly options: ConsoleLoggerOptions = {},
  ) {
    this.boundContext = snapshotLogContext(boundContext ?? {});
    this.componentName = componentName === undefined
      ? undefined
      : sanitizeLogString(componentName, REDACTED);
  }

  child(context: Record<string, unknown>): Logger {
    const childContext = snapshotLogContext(context);
    return new ConsoleLogger(
      this.prefix,
      { ...this.boundContext, ...childContext },
      this.componentName,
      this.options,
    );
  }

  component(name: string): Logger {
    return new ConsoleLogger(
      this.prefix,
      { ...this.boundContext },
      name,
      this.options,
    );
  }

  private createEmergencyEntry(level: LogEntry["level"]): LogEntry {
    const entry: LogEntry = {
      timestamp: currentIsoTimestamp(),
      level,
      service: apply(
        stringToLowerCase,
        sanitizeLogString(this.prefix, "veryfront"),
        [],
      ) as string,
      veryfrontVersion: RUNTIME_VERSION,
      message: REDACTED,
      context: { unserializable_context: REDACTED },
    };
    if (this.componentName) entry.component = this.componentName;
    return entry;
  }

  private createEntry(level: LogEntry["level"], message: string, args: unknown[]): LogEntry {
    const { context, error } = extractContext(args);
    const mergedContext: Record<string, unknown> = { ...this.boundContext, ...context };

    const entry: LogEntry = {
      timestamp: currentIsoTimestamp(),
      level,
      service: apply(stringToLowerCase, this.prefix, []) as string,
      veryfrontVersion: RUNTIME_VERSION,
      // The message string bypasses the key-based context redactor, so scrub
      // credential-shaped text (URL userinfo, ?access_token=, header dumps)
      // embedded directly in the message before emission (#1989).
      message: sanitizeLogString(message, REDACTED),
    };

    if (this.componentName) entry.component = this.componentName;

    // Extract known fields to top level for easier Grafana filtering
    extractToEntryField(entry, mergedContext, "requestId", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "traceId", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "spanId", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "projectSlug", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "durationMs", (v) => Number(v));

    // Auto-inject trace context from OTel when not already set
    if ((this.options.injectTraceContext ?? true) && traceContextGetter && !entry.traceId) {
      const traceCtx = traceContextGetter();
      if (traceCtx.traceId) {
        entry.traceId = traceCtx.traceId;
        entry.spanId = traceCtx.spanId;
      }
    }

    // Extract standard snake_case fields for Loki filtering
    extractToEntryField(entry, mergedContext, "request_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "trace_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "span_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "project_slug", sanitizeStringFieldValue);
    // Lifted string fields are removed from mergedContext before redactSensitive
    // runs, so scrub credential-shaped text while preserving the field value.
    extractToEntryField(entry, mergedContext, "request_url", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "domain", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "project_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "release_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "branch_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "branch_name", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "run_execution_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "run_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "agent_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "thread_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "schedule_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "schedule_name", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "tool_name", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "tool_call_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "batch_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "run_target", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "task", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "event_kind", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "user_visible", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "duration_ms", (v) => Number(v));
    extractToEntryField(entry, mergedContext, "user_id", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "conversation_id", sanitizeStringFieldValue);

    // Also extract camelCase variants so callers can use either convention
    extractToEntryField(entry, mergedContext, "userId", sanitizeStringFieldValue);
    extractToEntryField(entry, mergedContext, "conversationId", sanitizeStringFieldValue);
    extractAliasToEntryField(entry, mergedContext, "runId", "run_id", sanitizeStringFieldValue);
    extractAliasToEntryField(entry, mergedContext, "agentId", "agent_id", sanitizeStringFieldValue);
    extractAliasToEntryField(
      entry,
      mergedContext,
      "threadId",
      "thread_id",
      sanitizeStringFieldValue,
    );
    extractAliasToEntryField(
      entry,
      mergedContext,
      "scheduleId",
      "schedule_id",
      sanitizeStringFieldValue,
    );
    extractAliasToEntryField(
      entry,
      mergedContext,
      "scheduleName",
      "schedule_name",
      sanitizeStringFieldValue,
    );
    extractAliasToEntryField(
      entry,
      mergedContext,
      "toolName",
      "tool_name",
      sanitizeStringFieldValue,
    );
    extractAliasToEntryField(
      entry,
      mergedContext,
      "toolCallId",
      "tool_call_id",
      sanitizeStringFieldValue,
    );

    // Emit snake_case aliases for camelCase fields (transition period)
    if (entry.requestId && !entry.request_id) entry.request_id = entry.requestId;
    if (entry.traceId && !entry.trace_id) entry.trace_id = entry.traceId;
    if (entry.spanId && !entry.span_id) entry.span_id = entry.spanId;
    if (entry.projectSlug && !entry.project_slug) entry.project_slug = entry.projectSlug;
    if (entry.durationMs != null && entry.duration_ms == null) entry.duration_ms = entry.durationMs;
    if (entry.userId && !entry.user_id) entry.user_id = entry.userId;
    if (entry.conversationId && !entry.conversation_id) {
      entry.conversation_id = entry.conversationId;
    }

    // Redact credential-like keys from the free-form context bag before
    // serialization (the deliberate top-level fields above are already
    // extracted out of mergedContext, so they are unaffected).
    if (Object.keys(mergedContext).length > 0) entry.context = redactSensitive(mergedContext);
    // The serialized error (name/message/stack) bypasses the key-based
    // redactor; scrub credentials embedded in its message/stack (DSNs, Mongo
    // URIs, ?access_token= URLs, userinfo) before emission (#1989).
    if (error) entry.error = sanitizeSerializedError(error);

    return entry;
  }

  private formatJson(level: LogEntry["level"], message: string, args: unknown[]): string {
    const entry = this.createEntry(level, message, args);
    return stringifyLogEntry(entry);
  }

  private formatTextLine(level: LogEntry["level"], message: string, args: unknown[]): string {
    const { context, error } = extractContext(args);
    const mergedContext = { ...this.boundContext, ...context };
    const enableColor = shouldUseColor();
    // Mirror the JSON path: the message string bypasses the key-based context
    // redactor, so scrub credential-shaped text before rendering (#1989).
    const safeMessage = sanitizeLogString(message, REDACTED);

    const contextText = formatContextText(
      redactSensitive(mergedContext),
      sanitizeSerializedError(error),
      enableColor,
    );

    const { preset } = resolveLoggerConfig();
    if (preset === "cli") {
      // CLI preset: no timestamp or tag — 2-space indent + glyph only.
      const glyph = colorize(CLI_LEVEL_GLYPHS[level], LEVEL_COLORS[level], enableColor);
      return `  ${glyph} ${safeMessage}${contextText}`;
    }

    const timestamp = colorize(formatTimestamp(), ANSI.dim, enableColor);
    const tag = colorize(padTag(this.prefix), TAG_COLORS[this.prefix] ?? ANSI.cyan, enableColor);
    const glyph = colorize(LEVEL_GLYPHS[level], LEVEL_COLORS[level], enableColor);
    const componentTag = this.componentName
      ? ` ${colorize(`[${this.componentName}]`, ANSI.dim, enableColor)}`
      : "";
    return `${timestamp}  ${tag} ${glyph}${componentTag} ${safeMessage}${contextText}`;
  }

  private log(
    level: LogEntry["level"],
    logLevel: LogLevel,
    consoleMethod: "debug" | "log" | "warn" | "error",
    message: string,
    args: unknown[],
  ): void {
    try {
      const { level: resolvedLevel, format: resolvedFormat } = resolveLoggerConfig();
      if (resolvedLevel > logLevel) return;

      let emittedEntry: LogEntry;
      let line: string;
      try {
        if (resolvedFormat === "json") {
          emittedEntry = this.createEntry(level, message, args);
          line = stringifyLogEntry(emittedEntry);
        } else {
          line = this.formatTextLine(level, message, args);
          emittedEntry = this.createEntry(level, message, args);
        }
      } catch {
        try {
          emittedEntry = this.createEmergencyEntry(level);
          line = resolvedFormat === "json"
            ? stringifyLogEntry(emittedEntry)
            : `${apply(stringToUpperCase, level, [])}: ${REDACTED}`;
        } catch {
          return;
        }
      }

      if (legacyLogRecordEmitter) {
        try {
          legacyLogRecordEmitter(emittedEntry);
        } catch (_) {
          /* do not let telemetry export failures affect application logging */
        }
      }

      // Snapshot before invoking callbacks. Native Set iterators observe values
      // deleted and reinserted during iteration, which can otherwise invoke one
      // subscriber repeatedly (or keep a single log call alive indefinitely).
      const subscribers: LogRecordEmitter[] = [];
      const iterator = apply(setValues, logRecordSubscribers, []) as SetIterator<LogRecordEmitter>;
      while (true) {
        const next = apply(setIteratorNext, iterator, []) as IteratorResult<LogRecordEmitter>;
        if (next.done) break;
        apply(arrayPush, subscribers, [next.value]);
      }
      for (let index = 0; index < subscribers.length; index++) {
        const subscriber = subscribers[index]!;
        if (subscriber === legacyLogRecordEmitter) continue;
        try {
          subscriber(emittedEntry);
        } catch (_) {
          /* do not let telemetry export failures affect application logging */
        }
      }

      const consoleFn = NativeConsole[consoleMethod];
      if (typeof consoleFn === "function") {
        try {
          apply(consoleFn, NativeConsole, [line]);
        } catch (_) {
          /* logging sink failures must not affect application control flow */
        }
      }
    } catch (_) {
      /* every logging concern is contained by this final nonthrowing boundary */
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.log("debug", LogLevel.DEBUG, "debug", message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log("info", LogLevel.INFO, "log", message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log("warn", LogLevel.WARN, "warn", message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log("error", LogLevel.ERROR, "error", message, args);
  }

  async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const safeLabel = sanitizeLogString(label, REDACTED);
    const start = readPerformanceNow();
    try {
      const result = await fn();
      const durationMs = readPerformanceNow() - start;
      this.debug(`${safeLabel} completed`, { durationMs: numberRound(durationMs) });
      return result;
    } catch (error) {
      const durationMs = readPerformanceNow() - start;
      this.error(`${safeLabel} failed`, { durationMs: numberRound(durationMs) }, error);
      throw error;
    }
  }
}

function createLogger(prefix: string, options?: ConsoleLoggerOptions): ConsoleLogger {
  return new ConsoleLogger(prefix, undefined, undefined, options);
}

// Base loggers without request context
const baseCliLogger = createLogger("CLI");
const baseServerLogger = createLogger("SERVER");
const baseRendererLogger = createLogger("RENDERER");
const baseBundlerLogger = createLogger("BUNDLER");
const baseAgentLogger = createLogger("AGENT");
const baseProxyLogger = createLogger("PROXY");
const baseLogger = createLogger("VERYFRONT");

const BASE_LOGGER_MAP: Readonly<Record<string, ConsoleLogger>> = {
  CLI: baseCliLogger,
  SERVER: baseServerLogger,
  RENDERER: baseRendererLogger,
  BUNDLER: baseBundlerLogger,
  AGENT: baseAgentLogger,
  PROXY: baseProxyLogger,
};

/**
 * Request context getter - set by request-context.ts to avoid circular imports.
 * This pattern allows the logger module to be imported first without
 * depending on request-context.ts.
 */
let requestContextGetter: (() => { logger: Logger } | undefined) | null = null;

/**
 * Register the request context getter.
 * Called by request-context.ts during module initialization.
 * @internal
 */
export function __registerRequestContextGetter(
  getter: () => { logger: Logger } | undefined,
): void {
  requestContextGetter = getter;
}

/**
 * Trace context getter - set by trace-bridge.ts to avoid importing OTel
 * directly in the logger module. Returns the active span's traceId/spanId
 * when OTel is initialized.
 */
let traceContextGetter: (() => { traceId?: string; spanId?: string }) | null = null;

/**
 * Register the trace context getter.
 * Called by trace-bridge.ts after OTLP initialization.
 * @internal
 */
export function __registerTraceContextGetter(
  getter: () => { traceId?: string; spanId?: string },
): void {
  traceContextGetter = getter;
}

/**
 * Reset the trace context getter.
 * Only intended for testing purposes.
 * @internal
 */
export function __resetTraceContextGetterForTests(): void {
  traceContextGetter = null;
}

function withRequestLogger(base: Logger): Logger {
  try {
    const ctx = requestContextGetter?.();
    return ctx?.logger ?? base;
  } catch {
    return base;
  }
}

type ContextAwareLogMethod = "debug" | "info" | "warn" | "error";

type LoggerSelection = {
  selected: Logger;
  fallback: Logger;
};

function selectContextLogger(base: Logger): LoggerSelection {
  return { selected: withRequestLogger(base), fallback: base };
}

function selectComponentLoggers(base: Logger, componentName: string): LoggerSelection {
  let fallback: Logger = base;
  try {
    fallback = base.component(componentName);
  } catch {
    // The base logger itself is still a safe final fallback.
  }

  const requestLogger = withRequestLogger(base);
  if (requestLogger === base) return { selected: fallback, fallback };

  try {
    return { selected: requestLogger.component(componentName), fallback };
  } catch {
    return { selected: fallback, fallback };
  }
}

function invokeLoggerMethod(
  logger: Logger,
  method: ContextAwareLogMethod,
  message: string,
  args: unknown[],
): boolean {
  try {
    const callback = logger[method];
    if (typeof callback !== "function") return false;
    const callArgs: unknown[] = [message];
    for (let index = 0; index < args.length; index++) callArgs[index + 1] = args[index];
    apply(callback, logger, callArgs);
    return true;
  } catch {
    return false;
  }
}

function invokeContextAwareLog(
  base: Logger,
  method: ContextAwareLogMethod,
  message: string,
  args: unknown[],
): void {
  invokeSelectedLoggerMethod(selectContextLogger(base), method, message, args);
}

function invokeSelectedLoggerMethod(
  selection: LoggerSelection,
  method: ContextAwareLogMethod,
  message: string,
  args: unknown[],
): void {
  if (invokeLoggerMethod(selection.selected, method, message, args)) return;
  if (selection.selected !== selection.fallback) {
    invokeLoggerMethod(selection.fallback, method, message, args);
  }
}

function invokeContextAwareComponentLog(
  base: Logger,
  componentName: string,
  method: ContextAwareLogMethod,
  message: string,
  args: unknown[],
): void {
  invokeSelectedLoggerMethod(
    selectComponentLoggers(base, componentName),
    method,
    message,
    args,
  );
}

function invokeLoggerChild(
  logger: Logger,
  context: Record<string, unknown>,
): Logger | undefined {
  try {
    const callback = logger.child;
    if (typeof callback !== "function") return undefined;
    const child = apply(callback, logger, [context]) as unknown;
    if ((typeof child === "object" && child !== null) || typeof child === "function") {
      return child as Logger;
    }
  } catch {
    // Request-scoped logger composition must not escape the logging boundary.
  }
  return undefined;
}

function invokeSelectedLoggerChild(
  selection: LoggerSelection,
  context: Record<string, unknown>,
): Logger {
  const fallback = invokeLoggerChild(selection.fallback, context) ?? selection.fallback;
  const selected = selection.selected === selection.fallback
    ? fallback
    : invokeLoggerChild(selection.selected, context) ?? fallback;
  return createGuardedLogger({ selected, fallback });
}

function invokeLoggerComponent(logger: Logger, name: string): Logger | undefined {
  try {
    const callback = logger.component;
    if (typeof callback !== "function") return undefined;
    const component = apply(callback, logger, [name]) as unknown;
    if (
      (typeof component === "object" && component !== null) ||
      typeof component === "function"
    ) {
      return component as Logger;
    }
  } catch {
    // Component composition must remain inside the guarded facade.
  }
  return undefined;
}

function selectLoggerComponents(selection: LoggerSelection, name: string): LoggerSelection {
  const fallback = invokeLoggerComponent(selection.fallback, name) ?? selection.fallback;
  const selected = selection.selected === selection.fallback
    ? fallback
    : invokeLoggerComponent(selection.selected, name) ?? fallback;
  return { selected, fallback };
}

async function invokeSelectedLoggerTime<T>(
  selection: LoggerSelection,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const safeLabel = sanitizeLogString(label, REDACTED);
  const start = readPerformanceNow();
  try {
    const result = await fn();
    const durationMs = numberRound(readPerformanceNow() - start);
    invokeSelectedLoggerMethod(selection, "debug", `${safeLabel} completed`, [{ durationMs }]);
    return result;
  } catch (error) {
    const durationMs = numberRound(readPerformanceNow() - start);
    invokeSelectedLoggerMethod(selection, "error", `${safeLabel} failed`, [{ durationMs }, error]);
    throw error;
  }
}

function createGuardedLogger(selection: LoggerSelection): Logger {
  return {
    debug(message: string, ...args: unknown[]): void {
      invokeSelectedLoggerMethod(selection, "debug", message, args);
    },
    info(message: string, ...args: unknown[]): void {
      invokeSelectedLoggerMethod(selection, "info", message, args);
    },
    warn(message: string, ...args: unknown[]): void {
      invokeSelectedLoggerMethod(selection, "warn", message, args);
    },
    error(message: string, ...args: unknown[]): void {
      invokeSelectedLoggerMethod(selection, "error", message, args);
    },
    time<T>(label: string, fn: () => Promise<T>): Promise<T> {
      return invokeSelectedLoggerTime(selection, label, fn);
    },
    child(context: Record<string, unknown>): Logger {
      return invokeSelectedLoggerChild(selection, context);
    },
    component(name: string): Logger {
      return createGuardedLogger(selectLoggerComponents(selection, name));
    },
  };
}

/**
 * Create a context-aware logger proxy that automatically uses
 * request-scoped context from AsyncLocalStorage when available.
 */
function createContextAwareLogger(base: ConsoleLogger): Logger {
  return {
    debug(message: string, ...args: unknown[]): void {
      invokeContextAwareLog(base, "debug", message, args);
    },
    info(message: string, ...args: unknown[]): void {
      invokeContextAwareLog(base, "info", message, args);
    },
    warn(message: string, ...args: unknown[]): void {
      invokeContextAwareLog(base, "warn", message, args);
    },
    error(message: string, ...args: unknown[]): void {
      invokeContextAwareLog(base, "error", message, args);
    },
    time<T>(label: string, fn: () => Promise<T>): Promise<T> {
      return invokeSelectedLoggerTime(selectContextLogger(base), label, fn);
    },
    child(context: Record<string, unknown>): Logger {
      return invokeSelectedLoggerChild(selectContextLogger(base), context);
    },
    component(name: string): Logger {
      return createComponentAwareLogger(base, name);
    },
  };
}

/**
 * Create a component-scoped logger that still defers request-context
 * resolution to call time. This avoids eagerly binding to whatever
 * context exists at module load — critical because component loggers
 * are typically created as top-level constants.
 */
function createComponentAwareLogger(base: ConsoleLogger, componentName: string): Logger {
  return {
    debug(message: string, ...args: unknown[]): void {
      invokeContextAwareComponentLog(base, componentName, "debug", message, args);
    },
    info(message: string, ...args: unknown[]): void {
      invokeContextAwareComponentLog(base, componentName, "info", message, args);
    },
    warn(message: string, ...args: unknown[]): void {
      invokeContextAwareComponentLog(base, componentName, "warn", message, args);
    },
    error(message: string, ...args: unknown[]): void {
      invokeContextAwareComponentLog(base, componentName, "error", message, args);
    },
    time<T>(label: string, fn: () => Promise<T>): Promise<T> {
      return invokeSelectedLoggerTime(selectComponentLoggers(base, componentName), label, fn);
    },
    child(context: Record<string, unknown>): Logger {
      return invokeSelectedLoggerChild(
        selectComponentLoggers(base, componentName),
        context,
      );
    },
    component(name: string): Logger {
      return createComponentAwareLogger(base, name);
    },
  };
}

// Context-aware loggers that automatically include request context
export const cliLogger = createContextAwareLogger(baseCliLogger);
/** Shared server logger value. */
export const serverLogger = createContextAwareLogger(baseServerLogger);
/** Shared renderer logger value. */
export const rendererLogger = createContextAwareLogger(baseRendererLogger);
/** Shared bundler logger value. */
export const bundlerLogger = createContextAwareLogger(baseBundlerLogger);
/** Shared agent logger value. */
export const agentLogger = createContextAwareLogger(baseAgentLogger);
export const proxyLogger = createContextAwareLogger(baseProxyLogger);
/** Shared logger value. */
export const logger = createContextAwareLogger(baseLogger);

/**
 * Get the base logger without request context awareness.
 * Use this when you need to create a request-scoped logger in middleware.
 */
export function getBaseLogger(
  prefix: string,
  options?: ConsoleLoggerOptions,
): ConsoleLogger {
  const resolvedPrefix = apply(stringToUpperCase, prefix, []) as string;
  const validPrefix = resolvedPrefix in BASE_LOGGER_MAP ? resolvedPrefix : "VERYFRONT";

  if (options?.injectTraceContext === false) {
    return createLogger(validPrefix, options);
  }

  return BASE_LOGGER_MAP[resolvedPrefix] ?? baseLogger;
}

/**
 * Create a logger for a specific request context.
 * Useful for binding request-specific metadata to all logs.
 */
export function createRequestLogger(
  baseLogger: Logger,
  requestContext: {
    requestId?: string;
    traceId?: string;
    projectSlug?: string;
  },
): Logger {
  return baseLogger.child(requestContext);
}

/** Create run user logger. */
export function createRunUserLogger(
  baseLogger: Logger,
  runContext: {
    projectId: string;
    runExecutionId: string;
    task: string;
    batchId?: string | null;
    runTarget?: string | null;
    eventKind?: string;
  },
): Logger {
  return baseLogger.child({
    project_id: runContext.projectId,
    run_execution_id: runContext.runExecutionId,
    ...(runContext.batchId ? { batch_id: runContext.batchId } : {}),
    ...(runContext.runTarget ? { run_target: runContext.runTarget } : {}),
    task: runContext.task,
    event_kind: runContext.eventKind ?? "run_user_log",
    user_visible: "true",
  });
}
