/**
 * Unified CLI argument parsing utilities
 *
 * Provides a single, consistent way to extract and validate CLI arguments.
 *
 * @module cli/shared/args
 */

import { INVALID_ARGUMENT } from "veryfront/errors";
import type { Schema } from "veryfront/extensions/schema";
import { COMMANDS } from "../help/command-definitions.ts";
import { suggestCommand } from "./suggest.ts";
import type { ParsedArgs } from "./types.ts";

/** Compat type for safeParse result (SafeParseReturnType removed in zod v4). */
export type SafeParseResult<T> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: Error & { issues: unknown[] } };

/**
 * Argument specification for a single option
 */
export interface ArgSpec {
  /** Possible argument keys to check (e.g., ["project-slug", "p"]) */
  keys: string[];
  /** Type of the argument: "array" handles CSV strings and repeated flags */
  type: "string" | "boolean" | "number" | "array";
  /** Positional argument index (0 = first arg after command) */
  positional?: number;
}

/**
 * Map of schema field names to their arg specs
 */
export type ArgMap<T> = {
  [K in keyof T]?: ArgSpec;
};

export interface ArgParserOptions {
  /** Reject option keys that the command parser does not consume. */
  rejectUnknown?: boolean;
}

const ROUTER_ARG_KEYS = new Set([
  "color",
  "h",
  "help",
  "j",
  "json",
  "no-animation",
  "no-browser",
  "no-color",
  "no-input",
  "o",
  "output",
  "q",
  "quiet",
  "v",
  "verbose",
  "version",
  "y",
  "yes",
]);

function optionName(key: string): string {
  return `${key.length === 1 ? "-" : "--"}${key}`;
}

function validateKnownOptions<T>(
  args: ParsedArgs,
  argMap: ArgMap<T>,
): SafeParseResult<undefined> {
  const commandKeys = (Object.values(argMap) as (ArgSpec | undefined)[])
    .flatMap((spec) => spec?.keys ?? []);
  const allowedKeys = new Set([...commandKeys, ...ROUTER_ARG_KEYS]);
  const unknownKey = Object.keys(args).find((key) =>
    key !== "_" && key !== "__explicit" && !allowedKeys.has(key)
  );
  if (!unknownKey) return { success: true, data: undefined };

  const suggestion = suggestCommand(
    unknownKey,
    commandKeys.filter((key) => key.length > 1),
    Math.min(4, Math.max(2, Math.ceil(unknownKey.length * 0.35))),
  )[0];
  const hint = suggestion ? ` Did you mean ${optionName(suggestion)}?` : "";
  const error = Object.assign(
    new Error(`Unknown option ${optionName(unknownKey)}.${hint}`),
    { issues: [] },
  );
  return { success: false, error };
}

function coerceValue(
  value: unknown,
  type: ArgSpec["type"],
): string | boolean | number | string[] {
  if (type === "boolean") return parseBooleanValue(value) ?? String(value);
  if (type === "number") {
    return typeof value === "number" ? value : Number(String(value));
  }
  if (type === "array") {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
    if (value) return [String(value)];
    return [];
  }
  return String(value);
}

/**
 * Extract a single argument value from parsed args
 */
export function extractArg(
  args: ParsedArgs,
  spec: ArgSpec,
): string | boolean | number | string[] | undefined {
  const { keys, type, positional } = spec;

  for (const key of keys) {
    const value = args[key];
    if (value !== undefined) return coerceValue(value, type);
  }

  if (positional === undefined) return undefined;

  const value = args._[positional + 1]; // +1 because _[0] is the command name
  if (value === undefined) return undefined;

  return coerceValue(value, type);
}

/**
 * Extract all arguments according to an arg map
 */
export function extractArgs<T>(
  args: ParsedArgs,
  argMap: ArgMap<T>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [field, spec] of Object.entries(argMap)) {
    if (!spec) continue;

    const value = extractArg(args, spec as ArgSpec);
    if (value !== undefined) result[field] = value;
  }

  return result;
}

/**
 * Create a typed argument parser for a command
 *
 * @example
 * ```ts
 * const getPullArgsSchema = defineSchema((v) => v.object({
 *   projectSlug: v.string().optional(),
 *   projectDir: v.string().optional(),
 *   force: v.boolean().default(false),
 * }));
 * const PullArgsSchema = getPullArgsSchema();
 *
 * const parsePullArgs = createArgParser(PullArgsSchema, {
 *   projectSlug: { keys: ["project", "p"], type: "string", positional: 0 },
 *   projectDir: { keys: ["project-dir", "dir", "d"], type: "string" },
 *   force: { keys: ["force", "f"], type: "boolean" },
 * });
 *
 * const result = parsePullArgs(args);
 * if (result.success) {
 *   // result.data is typed as PullOptions
 * }
 * ```
 */
export function createArgParser<T>(
  schema: Schema<T>,
  argMap: ArgMap<T>,
  options: ArgParserOptions = {},
): (args: ParsedArgs) => SafeParseResult<T> {
  return function parseArgs(args: ParsedArgs): SafeParseResult<T> {
    if (options.rejectUnknown) {
      const knownOptions = validateKnownOptions(args, argMap);
      if (!knownOptions.success) return knownOptions;
    }

    const result = schema.safeParse(extractArgs(args, argMap));
    if (result.success) {
      return { success: true, data: result.data };
    }
    const message = result.issues?.map((i) => i.message).join("; ") ?? "Validation failed";
    const error = Object.assign(new Error(message), { issues: result.issues ?? [] });
    return { success: false, error };
  };
}

/**
 * Parse args with a parser function and throw on failure.
 * Eliminates the repeated parse-validate-throw boilerplate in handlers.
 */
export function parseArgsOrThrow<T>(
  parser: (args: ParsedArgs) => SafeParseResult<T>,
  commandName: string,
  args: ParsedArgs,
): T {
  const result = parser(args);
  if (!result.success) {
    throw INVALID_ARGUMENT.create({
      detail: `Invalid ${commandName} arguments: ${result.error.message}`,
      context: { command: commandName, issues: result.error.issues },
    });
  }
  return result.data;
}

/**
 * Common arg specs for reuse across commands
 */
export const CommonArgs = {
  force: { keys: ["force", "f"], type: "boolean" },
  dryRun: { keys: ["dry-run"], type: "boolean" },
  branch: { keys: ["branch", "b"], type: "string" },
  env: { keys: ["environment", "env", "e"], type: "string" },
  projectDir: { keys: ["project-dir", "dir", "d"], type: "string" },
  projectSlug: { keys: ["project", "project-slug", "p"], type: "string" },
  quiet: { keys: ["quiet", "q"], type: "boolean" },
  releaseName: { keys: ["release-name"], type: "string" },
  into: { keys: ["into"], type: "string" },
  release: { keys: ["release"], type: "string" },
  output: { keys: ["output", "o"], type: "string" },
  json: { keys: ["json", "j"], type: "boolean" },
} satisfies Record<string, ArgSpec>;

// ── Raw CLI argument parsing ────────────────────────────────────────────
// Low-level parser that converts process argv into a ParsedArgs object.
// Used once in cli/main.ts before routing to individual command handlers.

const ARRAY_FLAGS = new Set(["candidate-model"]);
const GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set(CommonArgs.output.keys);
const COMMAND_VALUE_ARG_KEYS: Readonly<Record<string, readonly string[]>> = {
  "analyze-chunks": CommonArgs.projectDir.keys,
  build: [
    ...CommonArgs.output.keys,
    "preset",
    "include",
    "exclude",
  ],
  clean: CommonArgs.projectDir.keys,
  demo: ["project-name", "login"],
  deploy: [
    ...CommonArgs.projectSlug.keys,
    ...CommonArgs.projectDir.keys,
    ...CommonArgs.branch.keys,
    ...CommonArgs.env.keys,
    ...CommonArgs.releaseName.keys,
  ],
  dev: ["port", "p", "project"],
  doctor: ["port", "p"],
  env: [
    ...CommonArgs.env.keys,
    ...CommonArgs.projectSlug.keys,
    ...CommonArgs.projectDir.keys,
  ],
  eval: [
    "id",
    "dataset-base",
    "report-dir",
    "report",
    "junit",
    "baseline",
    "write-baseline",
    "baseline-pass-rate-drop-threshold",
    "baseline-metric-pass-rate-drop-threshold",
    "baseline-failed-delta-threshold",
    "baseline-usage-increase-threshold",
    "baseline-latency-increase-threshold",
    "export",
    "model",
    "baseline-model",
    "candidate-model",
    "candidate-models",
    "comparison-policy",
    "max-output-tokens",
    "record-timeout",
  ],
  files: [
    ...CommonArgs.projectSlug.keys,
    ...CommonArgs.projectDir.keys,
    ...CommonArgs.output.keys,
    "path",
    "from",
  ],
  generate: ["type", "name"],
  init: ["name", "template", "t", "runtime", "integrations", "config", "c"],
  install: ["target", "t"],
  integration: [
    ...CommonArgs.projectSlug.keys,
    ...CommonArgs.projectDir.keys,
    "scope",
    "connection",
    "expected-generation",
    "args",
    "search",
    "tool",
    "redirect-uri",
    "timeout",
  ],
  knowledge: [
    ...CommonArgs.projectSlug.keys,
    ...CommonArgs.projectDir.keys,
    "path",
    "output-dir",
    "knowledge-path",
    "description",
    "desc",
    "slug",
  ],
  lock: ["project"],
  mcp: ["port"],
  merge: CommonArgs.into.keys,
  open: [
    ...CommonArgs.env.keys,
    ...CommonArgs.projectSlug.keys,
  ],
  project: [
    ...CommonArgs.projectSlug.keys,
    ...CommonArgs.projectDir.keys,
    ...CommonArgs.output.keys,
    "credential-file",
    "credential-mode",
    "query",
    "body",
    "idempotency-key",
    "if-match",
    "last-event-id",
    "conversation-id",
    "eval-id",
    "event-id",
    "input-request-id",
    "project-reference",
    "run-id",
    "webhook-definition-id",
  ],
  pull: [
    ...CommonArgs.projectSlug.keys,
    ...CommonArgs.projectDir.keys,
    ...CommonArgs.branch.keys,
    ...CommonArgs.env.keys,
    ...CommonArgs.release.keys,
    "projects",
  ],
  push: [
    ...CommonArgs.projectSlug.keys,
    ...CommonArgs.projectDir.keys,
    ...CommonArgs.branch.keys,
  ],
  routes: CommonArgs.projectDir.keys,
  schedule: [
    ...CommonArgs.projectDir.keys,
    "action",
    "id",
    "input",
  ],
  schema: ["category", "c"],
  serve: ["mode", "m", "port", "p", "hostname", "host", "binary-path"],
  start: ["port", "p", "project-dir", "project"],
  studio: ["project", "branch", "b", "file"],
  styles: ["subcommand", "config"],
  task: ["name", "config"],
  test: ["filter"],
  up: CommonArgs.projectDir.keys,
  uploads: [
    ...CommonArgs.projectSlug.keys,
    ...CommonArgs.projectDir.keys,
    "path",
    "output-dir",
    "from",
    "content-type",
  ],
  webhook: [
    ...CommonArgs.projectDir.keys,
    "action",
    "id",
    "payload",
  ],
  worker: [
    "redis-url",
    "redis",
    "concurrency",
    "c",
    "poll-interval",
    "stalled-threshold",
    "executor",
    "e",
    "entrypoint",
  ],
  workflow: ["action", "name", "input"],
};

/** Boolean options accepted by every command, regardless of the command word. */
export const GLOBAL_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "help",
  "version",
  "json",
  "yes",
  "quiet",
  "verbose",
  "no-input",
  "no-color",
  "color",
  "no-animation",
]);

function getDocumentedFlagKind(
  key: string,
  positionalArgs: string[],
): "boolean" | "value" | undefined {
  if (GLOBAL_BOOLEAN_FLAGS.has(key)) return "boolean";

  const command = positionalArgs[0];
  if (!command) return undefined;

  for (const option of COMMANDS[command]?.options ?? []) {
    const names = option.flag.match(/--?[a-z0-9-]+/gi) ?? [];
    if (names.some((name) => name.replace(/^-+/, "") === key)) {
      return option.flag.includes("<") ? "value" : "boolean";
    }
  }

  return undefined;
}

/**
 * Boolean options used when the command word cannot resolve an option's arity —
 * an unknown command, or a flag that appears before the command word. Every
 * documented long-name boolean in `COMMANDS` must be listed here, otherwise it
 * is parsed as value-taking and swallows the positional that follows it.
 * `cli/shared/args.test.ts` asserts that invariant.
 */
export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "accept-dispatch",
  "adopt-new-deps",
  "all",
  "auto",
  "binary",
  "build",
  "cache",
  "check",
  "clear",
  "color",
  "compress",
  "debug",
  "delete",
  "deploy",
  "dry-run",
  "force",
  "github",
  "global",
  "google",
  "headless",
  "help",
  "hmr",
  "json",
  "list",
  "microsoft",
  "ndjson",
  "no-adopt-pins",
  "no-animation",
  "no-browser",
  "no-color",
  "no-compress",
  "no-gpg-sign",
  "no-hmr",
  "no-input",
  "okf-bundle",
  "no-split",
  "no-ssg",
  "no-tui",
  "open",
  "parallel",
  "prefetch",
  "prune",
  "quiet",
  "recursive",
  "remote",
  "require-export",
  "site",
  "skip-env-prompt",
  "skip-install",
  "split",
  "ssg",
  "strict",
  "studio",
  "token",
  "update",
  "verbose",
  "verify",
  "version",
  "yes",
]);

function isBooleanFlag(key: string, positionalArgs: string[]): boolean {
  const documentedKind = getDocumentedFlagKind(key, positionalArgs);
  if (documentedKind !== undefined) return documentedKind === "boolean";
  return BOOLEAN_FLAGS.has(key);
}

function parseBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== "string") return undefined;

  switch (value.trim().toLowerCase()) {
    case "true":
    case "1":
    case "yes":
    case "on":
      return true;
    case "false":
    case "0":
    case "no":
    case "off":
    case "":
      return false;
    default:
      return undefined;
  }
}

function isValue(arg: string | undefined): boolean {
  return arg !== undefined && (!arg.startsWith("-") || /^-\d/.test(arg));
}

function getCommandName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === "help") return "help";
  if (Object.hasOwn(COMMANDS, value)) return value;

  return Object.entries(COMMANDS).find(([, definition]) =>
    (definition.aliases ?? []).includes(value)
  )?.[0];
}

function getCommandDefinition(value: string | undefined) {
  const commandName = getCommandName(value);
  if (commandName === undefined || commandName === "help") return undefined;
  return COMMANDS[commandName];
}

function isKnownCommandToken(value: string | undefined): boolean {
  return getCommandName(value) !== undefined;
}

function equivalentOptionKeys(key: string): string[] {
  for (const spec of Object.values(CommonArgs)) {
    if (spec.keys.includes(key)) return spec.keys;
  }

  return [key];
}

function commandAcceptsOption(command: string | undefined, key: string): boolean {
  const commandName = getCommandName(command);
  if (commandName === undefined) return false;

  const acceptedKeys = new Set(equivalentOptionKeys(key));
  const commonKeys = COMMAND_VALUE_ARG_KEYS[commandName] ?? [];
  if (commonKeys.some((commonKey) => acceptedKeys.has(commonKey))) return true;

  const definition = getCommandDefinition(command);
  for (const option of definition?.options ?? []) {
    const names = option.flag.match(/--?[a-z0-9-]+/gi) ?? [];
    if (names.some((name) => acceptedKeys.has(name.replace(/^-+/, "")))) return true;
  }

  return false;
}

function firstFollowingCommandToken(
  args: string[],
  start: number,
  aliasMap: ReadonlyMap<string, string>,
): string | undefined {
  for (let i = start; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (!arg.startsWith("-")) {
      if (isKnownCommandToken(arg)) return arg;
      continue;
    }

    if (arg === "--") {
      return args.slice(i + 1).find((value) => isKnownCommandToken(value));
    }
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) continue;

      const key = arg.slice(2);
      if (!isBooleanFlag(key, [] as string[]) && isValue(args[i + 1])) i++;
      continue;
    }

    if (arg.length === 2) {
      const short = arg.slice(1);
      const key = aliasMap.get(short) ?? short;
      const isBoolean = isBooleanFlag(key, [] as string[]) || isBooleanFlag(short, [] as string[]);
      if (!isBoolean && isValue(args[i + 1])) i++;
    }
  }

  return undefined;
}

function shouldConsumeLongOptionValue(
  key: string,
  next: string | undefined,
  positionalArgs: string[],
  followingCommand: string | undefined,
): boolean {
  if (isBooleanFlag(key, positionalArgs) || !isValue(next)) return false;

  // Before the command word is known, an unknown option has unknown arity. Do
  // not let it consume a valid command token and silently route to the default
  // command. A later command that documents the option still keeps its value,
  // including values that happen to match command names.
  if (
    positionalArgs.length === 0 &&
    isKnownCommandToken(next) &&
    !GLOBAL_VALUE_FLAGS.has(key) &&
    !commandAcceptsOption(followingCommand ?? "start", key)
  ) return false;

  return true;
}

function parse(
  args: string[],
  options: { alias?: Record<string, string>; default?: Record<string, unknown> } = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = { _: [] as string[], ...options.default };
  const aliasMap = new Map(Object.entries(options.alias ?? {}));
  const explicit: Record<string, true> = {};

  function setValue(key: string, value: unknown): void {
    explicit[key] = true;
    const converted = isBooleanFlag(key, result._ as string[])
      ? parseBooleanValue(value) ?? value
      : value;

    if (!ARRAY_FLAGS.has(key)) {
      result[key] = converted;
      return;
    }

    const arr = (result[key] as unknown[] | undefined) ?? [];
    result[key] = [...arr, converted];
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === "--") {
      (result._ as string[]).push(...args.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");

      if (eqIdx !== -1) {
        setValue(arg.slice(2, eqIdx), arg.slice(eqIdx + 1));
        continue;
      }

      const key = arg.slice(2);
      const next = args[i + 1];

      const followingCommand = firstFollowingCommandToken(args, i + 2, aliasMap);
      if (shouldConsumeLongOptionValue(key, next, result._ as string[], followingCommand)) {
        setValue(key, next);
        i++;
        continue;
      }

      setValue(key, true);
      continue;
    }

    if (arg.startsWith("-") && arg.length === 2) {
      const short = arg.slice(1);
      const key = aliasMap.get(short) ?? short;
      const next = args[i + 1];

      const isBoolean = isBooleanFlag(key, result._ as string[]) ||
        isBooleanFlag(short, result._ as string[]);
      const followingCommand = firstFollowingCommandToken(args, i + 2, aliasMap);
      const shouldPreserveCommandToken = (result._ as string[]).length === 0 &&
        isKnownCommandToken(next) &&
        !GLOBAL_VALUE_FLAGS.has(key) &&
        !GLOBAL_VALUE_FLAGS.has(short) &&
        !commandAcceptsOption(followingCommand ?? "start", key) &&
        !commandAcceptsOption(followingCommand ?? "start", short);

      if (!isBoolean && isValue(next) && !shouldPreserveCommandToken) {
        setValue(key, next);
        if (key !== short) setValue(short, next);
        i++;
        continue;
      }

      setValue(key, true);
      if (key !== short) setValue(short, true);
      continue;
    }

    (result._ as string[]).push(arg);
  }

  result.__explicit = explicit;
  return result;
}

/** Parse raw CLI arguments into a structured `ParsedArgs` object with aliases. */
export function parseCliArgs(args: string[]): ParsedArgs {
  return parse(args, {
    alias: {
      h: "help",
      v: "version",
      q: "quiet",
      f: "force",
      s: "strict",
      j: "json",
      o: "output",
      y: "yes",
      m: "mode",
    },
  }) as ParsedArgs;
}
