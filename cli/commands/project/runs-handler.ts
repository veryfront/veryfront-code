import { AUTHENTICATION_REQUIRED, INVALID_ARGUMENT, wrapUnknownError } from "veryfront/errors";
import { redactForSerialization } from "veryfront/utils";
import { createCanonicalVeryfrontApiTransport } from "#veryfront/platform/adapters/veryfront-api-transport.ts";
import { createRunsSdk, runsProblemOf } from "#veryfront/runs/target/client.ts";
import { getEnvironmentConfig } from "veryfront/config";
import {
  readConfigJsonFile,
  resolveApiCredentialCandidatesForAuth,
  resolveApiUrlTrust,
  UntrustedApiUrlCredentialError,
} from "../../shared/config.ts";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  type ErrorEnvelope,
  isJsonMode,
  outputJson,
  streamJsonLine,
} from "../../shared/json-output.ts";
import { resolveCliApiUrl } from "../../shared/constants.ts";
import type { ParsedArgs } from "#cli/shared/types";
import { exitProcess } from "#cli/utils";
import { parseRunsInvocation, runProjectRuns } from "./runs.ts";

const COMMAND = "project runs";

/** Use the normal trusted endpoint resolver; explicit scoped credentials come from a file. */
export async function handleProjectRuns(args: ParsedArgs): Promise<void> {
  const invocation = parseRunsInvocation(args);
  const projectDir = typeof args["project-dir"] === "string" ? args["project-dir"] : Deno.cwd();
  try {
    const sdk = await createProjectRunsSdk(args, projectDir);
    await runProjectRuns(args, sdk, (data) => emitRunsResult(data, invocation.stream));
  } catch (error) {
    await reportRunsFailure(error, invocation.stream);
  }
}

/**
 * Successful command results are intentional API output, not diagnostic logs.
 * Preserve the contract payload, including event-token credentials.
 */
async function emitRunsResult(data: unknown, stream: boolean): Promise<void> {
  if (!isJsonMode()) {
    console.log(JSON.stringify(data, null, stream ? undefined : 2));
  } else if (stream) {
    streamJsonLine({ ...createSuccessEnvelope(COMMAND, data) });
  } else {
    await outputJson(createSuccessEnvelope(COMMAND, data));
  }
}

function runsExitCode(problem: ReturnType<typeof runsProblemOf>, fallback: number | undefined) {
  if (!problem) return fallback ?? 1;
  return problem.status === 400 || problem.status === 422 ? 2 : 1;
}

async function reportRunsFailure(error: unknown, stream: boolean): Promise<void> {
  const problem = runsProblemOf(error);
  if (!problem && !(stream && isJsonMode())) throw error;
  const vfError = wrapUnknownError(error);
  const exitCode = runsExitCode(problem, vfError.exitCode);
  const usage = exitCode === 2;
  const message = problem ? problem.detail ?? problem.title : vfError.detail ?? vfError.message;
  const safe = redactForSerialization({
    code: problem?.code ?? (usage ? "USAGE_ERROR" : "RUNTIME_ERROR"),
    slug: usage ? "invalid-arguments" : "command-failed",
    registrySlug: vfError.slug,
    message,
  }) as ErrorEnvelope["error"];
  if (!isJsonMode()) {
    console.error(safe.message);
  } else if (stream) {
    streamJsonLine({ ...createErrorEnvelope(COMMAND, safe) });
  } else {
    await outputJson(createErrorEnvelope(COMMAND, safe));
  }
  exitProcess(exitCode);
}

/** Resolve host-owned credentials without executing project modules or requiring a user login for scoped calls. */
export async function createProjectRunsSdk(args: ParsedArgs, projectDir: string) {
  const mode = args["credential-mode"] ?? "bearer";
  if (mode !== "bearer" && mode !== "api-key") {
    throw INVALID_ARGUMENT.create({ detail: "Use --credential-mode bearer or api-key." });
  }
  let token: string;
  let apiUrl: string;
  if (args["credential-file"] !== undefined) {
    if (typeof args["credential-file"] !== "string") {
      throw INVALID_ARGUMENT.create({ detail: "Supply --credential-file with a path." });
    }
    const trust = resolveApiUrlTrust(getEnvironmentConfig(), await readConfigJsonFile(projectDir));
    if (trust.repositorySteered) {
      throw new UntrustedApiUrlCredentialError(
        "Set the API endpoint explicitly in your process environment before supplying a credential file.",
      );
    }
    apiUrl = trust.apiUrl;
    token = (await Deno.readTextFile(args["credential-file"])).trim();
    if (!token) throw INVALID_ARGUMENT.create({ detail: "The credential file is empty." });
  } else {
    const [candidate] = await resolveApiCredentialCandidatesForAuth(
      getEnvironmentConfig(),
      projectDir,
      false,
    );
    if (!candidate) {
      throw AUTHENTICATION_REQUIRED.create({
        detail: "Run veryfront login or supply a credential file.",
      });
    }
    apiUrl = candidate.validationEnv.apiUrl ?? resolveCliApiUrl(candidate.validationEnv);
    token = candidate.apiToken;
  }
  return createRunsSdk({
    transport: createCanonicalVeryfrontApiTransport(
      apiUrl,
      () => token,
      {
        maxRetries: 0,
        initialDelay: 0,
        maxDelay: 0,
      },
      undefined,
      mode,
    ),
  });
}
