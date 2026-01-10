import type { DiagnosticResult } from "./types.ts";
import { checkDenoVersion, checkReactCompatibility } from "./version-checks.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import {
  checkCacheSystem,
  checkConfiguration,
  checkProjectStructure,
} from "./project-structure.ts";
import { checkRSCCounters, checkRSCEndpoints, checkRSCFlag } from "./server-checks.ts";
import { checkAIConfig } from "./ai-checks.ts";
import { cliLogger } from "@veryfront/utils";

const STATUS_TAGS: Record<DiagnosticResult["status"], string> = {
  pass: "[PASS]",
  warn: "[WARN]",
  fail: "[FAIL]",
};

/**
 * Summarize diagnostic results
 */
function summarizeResults(results: DiagnosticResult[]): { warnCount: number; failCount: number } {
  return results.reduce(
    (acc, result) => {
      if (result.status === "warn") acc.warnCount++;
      if (result.status === "fail") acc.failCount++;
      return acc;
    },
    { warnCount: 0, failCount: 0 },
  );
}

/**
 * Main doctor command orchestrator
 * Runs all diagnostic checks and reports results
 */
export async function doctorCommand(projectDir: string, opts: { strict?: boolean } = {}) {
  const results: DiagnosticResult[] = [];

  // Run all diagnostic checks
  results.push(await checkDenoVersion());
  results.push(...(await checkProjectStructure(projectDir)));
  results.push(await checkConfiguration(projectDir));
  results.push(await checkCacheSystem());
  results.push(await checkReactCompatibility());
  results.push(await checkRSCFlag());
  results.push(...(await checkRSCEndpoints()));
  results.push(await checkRSCCounters());
  results.push(...(await checkAIConfig(projectDir)));

  // Print concise summary to stdout (non-interactive)
  for (const r of results) {
    cliLogger.info(`${STATUS_TAGS[r.status]} ${r.name}: ${r.message}`);
  }

  const { warnCount, failCount } = summarizeResults(results);

  if (failCount > 0) {
    throw toError(createError({
      type: "config",
      message: `Doctor checks failed: ${failCount} failed, ${warnCount} warnings`,
    }));
  }
  if (opts.strict && warnCount > 0) {
    throw toError(createError({
      type: "config",
      message: `Doctor strict mode: ${warnCount} warning(s) present`,
    }));
  }
}
