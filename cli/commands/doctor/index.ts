import type { DiagnosticResult } from "./types.ts";
import { checkDenoVersion, checkReactCompatibility } from "./version-checks.ts";
import { createError, toError } from "veryfront/errors";
import { getConfig } from "veryfront/config";
import { runtime } from "veryfront/platform";
import {
  checkCacheSystem,
  checkConfiguration,
  checkProjectStructure,
} from "./project-structure.ts";
import { checkRSCCounters, checkRSCEndpoints, checkRSCFlag } from "./server-checks.ts";
import { checkAIConfig } from "./ai-checks.ts";
import { bold, checkList, error, success, warning } from "#cli/ui";
import { DEFAULT_DEV_PORT } from "#cli/shared/constants";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";

export async function resolveDoctorPort(
  projectDir: string,
  explicitPort?: number,
): Promise<number> {
  if (explicitPort !== undefined) return explicitPort;

  try {
    const adapter = await runtime.get();
    const config = await getConfig(projectDir, adapter);
    return config?.dev?.port ?? DEFAULT_DEV_PORT;
  } catch {
    return DEFAULT_DEV_PORT;
  }
}

function summarizeResults(
  results: DiagnosticResult[],
): { passCount: number; warnCount: number; failCount: number } {
  let warnCount = 0;
  let failCount = 0;

  for (const result of results) {
    if (result.status === "warn") warnCount++;
    if (result.status === "fail") failCount++;
  }

  return {
    passCount: results.length - warnCount - failCount,
    warnCount,
    failCount,
  };
}

export async function reportDoctorResults(
  results: DiagnosticResult[],
  opts: {
    port: number;
    strict?: boolean;
  },
): Promise<void> {
  const { passCount, warnCount, failCount } = summarizeResults(results);

  if (isJsonMode()) {
    if (failCount > 0) {
      throw toError(
        createError({
          type: "config",
          message: `Doctor checks failed: ${failCount} failed, ${warnCount} warnings`,
        }),
      );
    }

    if (warnCount > 0 && opts.strict) {
      throw toError(
        createError({
          type: "config",
          message: `Doctor strict mode: ${warnCount} warning(s) present`,
        }),
      );
    }

    await outputJson(createSuccessEnvelope("doctor", {
      port: opts.port,
      strict: opts.strict ?? false,
      checks: results,
      summary: {
        total: results.length,
        passed: passCount,
        warnings: warnCount,
        failed: failCount,
      },
    }));
    return;
  }

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

export async function doctorCommand(
  projectDir: string,
  opts: { strict?: boolean; port?: number } = {},
): Promise<void> {
  const port = await resolveDoctorPort(projectDir, opts.port);
  const results: DiagnosticResult[] = [
    await checkDenoVersion(),
    ...(await checkProjectStructure(projectDir)),
    await checkConfiguration(projectDir),
    await checkCacheSystem(),
    await checkReactCompatibility(),
    await checkRSCFlag(),
    ...(await checkRSCEndpoints(port)),
    await checkRSCCounters(port),
    ...(await checkAIConfig(projectDir)),
  ];

  await reportDoctorResults(results, {
    port,
    strict: opts.strict,
  });
}
