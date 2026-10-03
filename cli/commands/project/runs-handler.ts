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

/** Use the normal trusted endpoint resolver; explicit scoped credentials come from a file. */
export async function handleProjectRuns(args: ParsedArgs): Promise<void> {
  const invocation = parseRunsInvocation(args);
  const projectDir = typeof args["project-dir"] === "string" ? args["project-dir"] : Deno.cwd();
  const command = "project runs";
  try {
    const sdk = await createProjectRunsSdk(args, projectDir);
    await runProjectRuns(args, sdk, async (data) => {
      // Successful command results are intentional API output, not diagnostic logs.
      // Preserve the contract payload, including event-token credentials.
      if (invocation.stream && isJsonMode()) {
        streamJsonLine({ ...createSuccessEnvelope(command, data) });
      } else if (isJsonMode()) await outputJson(createSuccessEnvelope(command, data));
      else console.log(JSON.stringify(data, null, invocation.stream ? undefined : 2));
    });
  } catch (error) {
    const problem = runsProblemOf(error);
    if (!problem && !(invocation.stream && isJsonMode())) throw error;
    const vfError = wrapUnknownError(error);
    const exitCode = problem
      ? (problem.status === 400 || problem.status === 422 ? 2 : 1)
      : vfError.exitCode ?? 1;
    const usage = exitCode === 2;
    const safe = redactForSerialization({
      code: problem?.code ?? (usage ? "USAGE_ERROR" : "RUNTIME_ERROR"),
      slug: usage ? "invalid-arguments" : "command-failed",
      registrySlug: vfError.slug,
      message: problem ? problem.detail ?? problem.title : vfError.detail ?? vfError.message,
    }) as ErrorEnvelope["error"];
    if (isJsonMode()) {
      const envelope = createErrorEnvelope(command, safe);
      if (invocation.stream) streamJsonLine({ ...envelope });
      else await outputJson(envelope);
    } else console.error(safe.message);
    exitProcess(exitCode);
  }
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
