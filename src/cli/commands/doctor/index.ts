import type { DiagnosticResult } from "./types.ts";
import { checkDenoVersion, checkReactCompatibility } from "./version-checks.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  checkCacheSystem,
  checkConfiguration,
  checkProjectStructure,
} from "./project-structure.ts";
import { checkRSCCounters, checkRSCEndpoints, checkRSCFlag } from "./server-checks.ts";
import { checkAIConfig } from "./ai-checks.ts";
import { checkList } from "../../ui/components/table.ts";
import { bold, error, success, warning } from "../../ui/colors.ts";

function summarizeResults(
  results: DiagnosticResult[],
): { warnCount: number; failCount: number } {
  let warnCount = 0;
  let failCount = 0;

  for (const result of results) {
    if (result.status === "warn") warnCount++;
    if (result.status === "fail") failCount++;
  }

  return { warnCount, failCount };
}

export async function doctorCommand(
  projectDir: string,
  opts: { strict?: boolean } = {},
): Promise<void> {
  const results: DiagnosticResult[] = [
    await checkDenoVersion(),
    ...(await checkProjectStructure(projectDir)),
    await checkConfiguration(projectDir),
    await checkCacheSystem(),
    await checkReactCompatibility(),
    await checkRSCFlag(),
    ...(await checkRSCEndpoints()),
    await checkRSCCounters(),
    ...(await checkAIConfig(projectDir)),
  ];

  console.log();
  console.log(`  ${bold("System Diagnostics")}`);
  console.log();
  console.log(
    checkList(
      results.map((result) => ({
        label: result.name,
        status: result.status,
        detail: result.message,
      })),
    ),
  );
  console.log();

  const { warnCount, failCount } = summarizeResults(results);
  const passCount = results.length - warnCount - failCount;

  if (failCount > 0) {
    console.log(`  ${error("✗")} ${failCount} failed, ${warnCount} warnings, ${passCount} passed`);
    console.log();
    throw toError(
      createError({
        type: "config",
        message: `Doctor checks failed: ${failCount} failed, ${warnCount} warnings`,
      }),
    );
  }

  if (warnCount > 0) {
    console.log(`  ${warning("!")} ${warnCount} warnings, ${passCount} passed`);
    console.log();

    if (opts.strict) {
      throw toError(
        createError({
          type: "config",
          message: `Doctor strict mode: ${warnCount} warning(s) present`,
        }),
      );
    }

    return;
  }

  console.log(`  ${success("✓")} All ${passCount} checks passed`);
  console.log();
}
