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
import {
  checkRSCCounters,
  checkRSCEndpoints,
  checkRSCFlag,
  isRscDiagnosticsEnabled,
} from "./server-checks.ts";
import { checkAIConfig } from "./ai-checks.ts";
import {
  bold,
  checkList,
  createSpinner,
  error,
  formatDuration,
  type SpinnerController,
  warning,
} from "#cli/ui";
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

function formatWarningCount(count: number): string {
  return `${count} warning${count === 1 ? "" : "s"}`;
}

type CheckFn = () => Promise<DiagnosticResult | DiagnosticResult[]>;
type SpinnerFactory = (text: string) => SpinnerController;

export async function streamCheck(
  fn: CheckFn,
  allResults: DiagnosticResult[],
  spinnerFactory: SpinnerFactory = createSpinner,
): Promise<void> {
  const spinner = spinnerFactory("Checking...");
  let raw: DiagnosticResult | DiagnosticResult[];
  try {
    raw = await fn();
  } catch (cause) {
    spinner.stop();
    throw cause;
  }
  const batch = Array.isArray(raw) ? raw : [raw];

  if (batch.length === 0) {
    spinner.stop();
    return;
  }

  const label = (r: DiagnosticResult) => r.message ? `${r.name} - ${r.message}` : r.name;

  const [first, ...rest] = batch;

  switch (first!.status) {
    case "pass":
      spinner.success(label(first!));
      break;
    case "warn":
      spinner.stop();
      console.log(`  ${warning("!")} ${label(first!)}`);
      break;
    default:
      spinner.error(label(first!));
      break;
  }
  allResults.push(first!);

  for (const result of rest) {
    switch (result.status) {
      case "pass":
        console.log(`  ✓ ${label(result)}`);
        break;
      case "warn":
        console.log(`  ${warning("!")} ${label(result)}`);
        break;
      default:
        console.log(`  ${error("✗")} ${label(result)}`);
        break;
    }
    allResults.push(result);
  }
}

export async function reportDoctorResults(
  results: DiagnosticResult[],
  opts: {
    port: number;
    strict?: boolean;
    duration?: number;
    streaming?: boolean;
  },
): Promise<void> {
  const { passCount, warnCount, failCount } = summarizeResults(results);
  const warnLabel = formatWarningCount(warnCount);

  if (isJsonMode()) {
    if (failCount > 0) {
      throw toError(
        createError({
          type: "config",
          message: `Doctor checks failed: ${failCount} failed, ${warnLabel}`,
        }),
      );
    }

    if (warnCount > 0 && opts.strict) {
      throw toError(
        createError({
          type: "config",
          message: `Doctor strict mode: ${warnLabel} present`,
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

  if (!opts.streaming) {
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
  }

  const durationSuffix = opts.duration !== undefined ? ` in ${formatDuration(opts.duration)}` : "";

  if (failCount > 0) {
    console.log(`  ${error("✗")} ${failCount} failed, ${warnLabel}, ${passCount} passed`);
    console.log();
    throw toError(
      createError({
        type: "config",
        message: `Doctor checks failed: ${failCount} failed, ${warnLabel}`,
      }),
    );
  }

  if (warnCount > 0) {
    console.log(`  ${warning("!")} ${warnLabel}, ${passCount} passed`);
    console.log();

    if (opts.strict) {
      throw toError(
        createError({
          type: "config",
          message: `Doctor strict mode: ${warnLabel} present`,
        }),
      );
    }

    return;
  }

  console.log(`  ✓ All ${passCount} checks passed${durationSuffix}`);
  console.log();
}

export async function doctorCommand(
  projectDir: string,
  opts: { strict?: boolean; port?: number } = {},
): Promise<void> {
  const port = await resolveDoctorPort(projectDir, opts.port);
  const startTime = Date.now();

  // RSC endpoints only exist behind the experimental flag; probing them
  // otherwise reports unreachable endpoints as project health problems.
  const rscEnabled = await isRscDiagnosticsEnabled(projectDir);

  if (isJsonMode()) {
    const results: DiagnosticResult[] = [
      await checkDenoVersion(),
      ...(await checkProjectStructure(projectDir)),
      await checkConfiguration(projectDir),
      await checkCacheSystem(),
      await checkReactCompatibility(),
      await checkRSCFlag(projectDir),
      ...(rscEnabled ? await checkRSCEndpoints(port) : []),
      ...(rscEnabled ? [await checkRSCCounters(port)] : []),
      ...(await checkAIConfig(projectDir)),
    ];
    await reportDoctorResults(results, {
      port,
      strict: opts.strict,
      duration: Date.now() - startTime,
    });
    return;
  }

  // Human mode: stream each check result with a spinner as it completes
  const results: DiagnosticResult[] = [];

  console.log();
  console.log(`  ${bold("System Diagnostics")}`);
  console.log();

  await streamCheck(checkDenoVersion, results);
  await streamCheck(() => checkProjectStructure(projectDir), results);
  await streamCheck(() => checkConfiguration(projectDir), results);
  await streamCheck(checkCacheSystem, results);
  await streamCheck(checkReactCompatibility, results);
  await streamCheck(() => checkRSCFlag(projectDir), results);
  if (rscEnabled) {
    await streamCheck(() => checkRSCEndpoints(port), results);
    await streamCheck(() => checkRSCCounters(port), results);
  }
  await streamCheck(() => checkAIConfig(projectDir), results);

  console.log();
  await reportDoctorResults(results, {
    port,
    strict: opts.strict,
    duration: Date.now() - startTime,
    streaming: true,
  });
}
