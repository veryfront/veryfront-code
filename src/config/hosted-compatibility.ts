/**
 * Static answer to "will Veryfront Cloud be able to read this config file?".
 *
 * A hosted project's `veryfront.config.ts` is never imported: the shared
 * multi-project runtime evaluates it as data through the bounded declarative
 * evaluator, which accepts only literals and the four `veryfront` helpers.
 * Anything else is rejected on every request, so the deploy itself looks
 * healthy while the environment answers 500 to all traffic.
 *
 * This module lets a deploy make that verdict before it creates a release. It
 * reports a rejection only when this evaluation and the hosted one are bound to
 * agree:
 *
 * - `validate`-phase rejections are decided by the parsed program alone, so a
 *   caller without the deployment environment's variables reaches exactly the
 *   verdict the hosted evaluator will.
 * - `result`-phase rejections are decided by the evaluated configuration. When
 *   nothing in the source can read deployment environment data, that record is
 *   the source's own literals and the verdict is equally fixed. `cache.dir` is
 *   the plain case: a literal config that sets it is refused on every hosted
 *   request, and the deploy that shipped it reported success.
 *
 * A source that can read the environment is left alone in the `result` phase: a
 * config whose `security.cors.origin` comes from `getEnv("ORIGINS")` evaluates
 * to nothing against an empty local environment, and a deploy must never be
 * blocked by a difference the developer cannot see.
 *
 * @module config/hosted-compatibility
 */

import {
  type DeclarativeConfigErrorCode,
  type DeclarativeConfigErrorReason,
  DeclarativeConfigEvaluationError,
  type DeclarativeConfigFileName,
  evaluateDeclarativeConfig,
} from "./declarative-evaluator.ts";
import { sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";

/** Longest source excerpt echoed back to the developer. */
const MAX_SOURCE_EXCERPT_CHARACTERS = 160;

/**
 * The names through which a configuration file can reach environment data.
 *
 * `getEnv` reads a deployment variable and `defineConfigWithEnv` hands the
 * environment name to a callback; the hosted evaluator binds nothing else that
 * can. An import names the helper it takes even when it renames it locally
 * (`import { getEnv as env }`), so a source that mentions neither name
 * evaluates to what its own literals say, here and in production alike.
 */
const ENVIRONMENT_READING_HELPERS = /\b(?:getEnv|defineConfigWithEnv)\b/;

// deno-lint-ignore no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

/** A statically decided reason a config cannot run on Veryfront Cloud. */
export interface HostedConfigIncompatibility {
  readonly code: DeclarativeConfigErrorCode;
  readonly reason: DeclarativeConfigErrorReason;
  /** One-based line of the offending construct, when the evaluator located it. */
  readonly line?: number;
  /** The offending source line, trimmed and bounded, when one was located. */
  readonly excerpt?: string;
  /** What the hosted runtime cannot do, in one sentence. */
  readonly summary: string;
  /** The change that makes the project deployable. */
  readonly remedy: string;
}

/**
 * Describe why `source` cannot be evaluated by the hosted runtime, or return
 * `null` when nothing statically rules it out.
 *
 * Never throws: an evaluator that cannot run (no parser installed, for
 * example) reports "nothing statically ruled out" rather than blocking a
 * deploy on this check's own unavailability.
 */
export async function findHostedConfigIncompatibility(
  source: string,
  fileName: DeclarativeConfigFileName = "veryfront.config.ts",
): Promise<HostedConfigIncompatibility | null> {
  let error: unknown;
  try {
    await evaluateDeclarativeConfig({
      source,
      fileName,
      environmentName: "production",
      environment: {},
    });
    return null;
  } catch (caught) {
    error = caught;
  }

  if (!(error instanceof DeclarativeConfigEvaluationError)) return null;
  if (!isDecidedByTheSourceAlone(error, source)) return null;

  // Only a validate-phase rejection is located at the construct it refused. A
  // result-phase one is reported against the program, so pointing at a line
  // would send the reader to the top of their file for a key further down.
  const line = error.phase === "validate" ? error.location?.line : undefined;
  const excerpt = line === undefined ? undefined : sourceExcerpt(source, line);
  return {
    code: error.code,
    reason: error.reason,
    ...(line === undefined ? {} : { line }),
    ...(excerpt === undefined ? {} : { excerpt }),
    ...describeReason(error.reason),
  };
}

/**
 * Render an incompatibility as the message a developer reads in their
 * terminal: what was found, where, and what to do about it.
 */
export function formatHostedConfigIncompatibility(
  incompatibility: HostedConfigIncompatibility,
  fileName: string,
): string {
  const at = incompatibility.line === undefined ? fileName : `${fileName}:${incompatibility.line}`;
  const found = incompatibility.excerpt === undefined ? "" : `\n  ${incompatibility.excerpt}`;
  return `${at} cannot be deployed to Veryfront Cloud. ${incompatibility.summary}${found}\n` +
    `${incompatibility.remedy}`;
}

/**
 * The same explanation, for a rejection that was only discovered once the
 * hosted runtime tried to serve the project. Keeps the terminal message and
 * the served error saying the same thing about the same config.
 */
export function describeHostedConfigRejection(
  reason: DeclarativeConfigErrorReason,
): string {
  const { summary, remedy } = describeReason(reason);
  return `${summary} ${remedy}`;
}

/**
 * Would the hosted evaluator reject `source` for the same reason, whatever the
 * deployment environment holds?
 *
 * Anything this answers `false` for is left to the hosted runtime: an
 * unavailable parser, a rejection this caller's empty environment produced, and
 * every other verdict a deploy must not make on a difference it cannot see.
 */
function isDecidedByTheSourceAlone(
  error: DeclarativeConfigEvaluationError,
  source: string,
): boolean {
  if (error.phase === "validate") return true;
  return error.phase === "result" &&
    error.code === "unsupported-hosted-feature" &&
    !ENVIRONMENT_READING_HELPERS.test(source);
}

function describeReason(
  reason: DeclarativeConfigErrorReason,
): { summary: string; remedy: string } {
  if (reason === "unsupported-import" || reason === "import-form") {
    return {
      summary:
        `The hosted runtime reads the configuration file as data and never imports project ` +
        `modules: it accepts one import statement, naming any of defineConfig, ` +
        `defineConfigWithEnv, getEnv and mergeConfigs from "veryfront", and no other import at ` +
        `all. An imported extension is a function call that runtime cannot make, so a project ` +
        `that declares one answers 500 on every request.`,
      remedy:
        `Remove the import and the value it provides from the configuration file. Extensions ` +
        `declared this way are supported when you run or self-host the project yourself; they ` +
        `cannot be declared in a configuration file deployed to Veryfront Cloud.`,
    };
  }
  if (reason === "hosted-extensions") {
    return {
      summary:
        `The hosted runtime does not run project-declared extensions: the only entry it accepts ` +
        `under "extensions" is { name, enabled: false }, which turns an extension off.`,
      remedy:
        `Remove the extension entries from the configuration file. Extensions are supported when ` +
        `you run or self-host the project yourself.`,
    };
  }
  if (reason === "hosted-cache-directory") {
    return {
      summary:
        `The hosted runtime has no project-writable cache directory: it serves every project from ` +
        `a shared runtime whose caches live in memory, so "cache.dir" names a location that does ` +
        `not exist there.`,
      remedy:
        `Remove "cache.dir" from the configuration file. It applies when you run or self-host the ` +
        `project yourself.`,
    };
  }
  if (reason === "hosted-cache-option") {
    return {
      summary:
        `The hosted runtime accepts only "bundleManifest", "render" and "queryParams" under ` +
        `"cache". Every other cache option belongs to a backend it does not run.`,
      remedy: `Remove the other "cache" options from the configuration file.`,
    };
  }
  if (
    reason === "hosted-bundle-manifest-backend" ||
    reason === "hosted-render-cache-backend"
  ) {
    return {
      summary:
        `The hosted runtime keeps render and bundle-manifest caches in memory: it selects no other ` +
        `cache backend and accepts no backend-specific option.`,
      remedy:
        `Remove the backend selection and its options, or set type: "memory". Other backends are ` +
        `supported when you run or self-host the project yourself.`,
    };
  }
  if (reason === "hosted-render-cache-capacity") {
    return {
      summary:
        `The hosted runtime bounds a project's render cache: "cache.render.maxEntries" asks for ` +
        `more entries than a shared environment gives one project.`,
      remedy:
        `Lower "cache.render.maxEntries", or leave it unset and let the hosted runtime size the ` +
        `cache.`,
    };
  }
  if (reason === "hosted-custom-middleware") {
    return {
      summary:
        `The hosted runtime does not run project-supplied middleware: "middleware.custom" is a ` +
        `list of functions it can neither read nor call, so it accepts only an empty one.`,
      remedy:
        `Remove the "middleware.custom" entries. Custom middleware is supported when you run or ` +
        `self-host the project yourself.`,
    };
  }
  if (reason === "hosted-cors-origin") {
    return {
      summary:
        `The hosted runtime accepts "security.cors.origin" only as a plain origin string or a ` +
        `list of them.`,
      remedy: `Give "security.cors.origin" a string or an array of strings.`,
    };
  }
  return {
    summary:
      `The hosted runtime reads the configuration file as data: it accepts literals, the four ` +
      `veryfront configuration helpers, and nothing that has to be executed.`,
    remedy: `Replace the reported construct with a literal value.`,
  };
}

/**
 * The offending line, in the form it is safe to print.
 *
 * The line is the project's own source and travels into a terminal and a CI
 * log, so credential-shaped content is masked before anything is cut away —
 * the order `sanitizeUrlCredentials` needs, since truncating first can split a
 * `scheme://user:password@host` before the `@host` it matches on. What remains
 * is the construct's shape, which is what the reader came for.
 */
function sourceExcerpt(source: string, line: number): string | undefined {
  const text = source.split("\n")[line - 1];
  if (text === undefined) return undefined;
  const normalized = sanitizeUrlCredentials(text).replace(CONTROL_CHARACTERS, " ").trim();
  if (normalized.length === 0) return undefined;
  return normalized.length > MAX_SOURCE_EXCERPT_CHARACTERS
    ? `${normalized.slice(0, MAX_SOURCE_EXCERPT_CHARACTERS)}…`
    : normalized;
}
