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
 * reports only the rejections the evaluator reaches during its `validate`
 * phase: those are decided by the parsed program alone, so a caller without
 * the deployment environment's variables reaches exactly the same verdict the
 * hosted evaluator will. Rejections that depend on evaluated values are
 * deliberately not reported here — a config that reads `getEnv("ORIGINS")`
 * would evaluate differently against an empty local environment, and a deploy
 * must never be blocked by a difference the developer cannot see.
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

/** Longest source excerpt echoed back to the developer. */
const MAX_SOURCE_EXCERPT_CHARACTERS = 160;

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
  if (error.phase !== "validate") return null;

  const line = error.location?.line;
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
  return {
    summary:
      `The hosted runtime reads the configuration file as data: it accepts literals, the four ` +
      `veryfront configuration helpers, and nothing that has to be executed.`,
    remedy: `Replace the reported construct with a literal value.`,
  };
}

function sourceExcerpt(source: string, line: number): string | undefined {
  const text = source.split("\n")[line - 1];
  if (text === undefined) return undefined;
  const normalized = text.replace(CONTROL_CHARACTERS, " ").trim();
  if (normalized.length === 0) return undefined;
  return normalized.length > MAX_SOURCE_EXCERPT_CHARACTERS
    ? `${normalized.slice(0, MAX_SOURCE_EXCERPT_CHARACTERS)}…`
    : normalized;
}
