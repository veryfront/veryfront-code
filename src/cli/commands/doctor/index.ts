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

export async function doctorCommand(projectDir: string, opts: { strict?: boolean } = {}) {
  const results: DiagnosticResult[] = [];

  results.push(await checkDenoVersion());
  results.push(...(await checkProjectStructure(projectDir)));
  results.push(await checkConfiguration(projectDir));
  results.push(await checkCacheSystem());
  results.push(await checkReactCompatibility());
  results.push(await checkRSCFlag());
  results.push(...(await checkRSCEndpoints()));
  results.push(await checkRSCCounters());
  results.push(...(await checkAIConfig(projectDir)));

  for (const r of results) {
    const tag = r.status === "pass" ? "[PASS]" : r.status === "warn" ? "[WARN]" : "[FAIL]";
    cliLogger.info(`${tag} ${r.name}: ${r.message}`);
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
