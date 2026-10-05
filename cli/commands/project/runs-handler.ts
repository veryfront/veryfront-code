import { AUTHENTICATION_REQUIRED, INVALID_ARGUMENT, wrapUnknownError } from "veryfront/errors";
import { redactForSerialization } from "veryfront/utils";
import { createRunsApiTransport, createRunsSdk, runsProblemOf } from "veryfront/runs/target";
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
  const ndjson = args.ndjson === true;
  let stream = ndjson;
  const projectDir = typeof args["project-dir"] === "string" ? args["project-dir"] : Deno.cwd();
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  let outputFailed = false;
  if (ndjson) Deno.addSignalListener("SIGINT", interrupt);
  try {
    const invocation = parseRunsInvocation(args);
    stream = invocation.stream;
    const sdk = await createProjectRunsSdk(args, projectDir);
    await runProjectRuns(args, sdk, async (data) => {
      try {
        await emitRunsResult(data, invocation, controller.signal);
      } catch (error) {
        outputFailed = true;
        throw error;
      }
    }, {
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) exitProcess(130);
    if (ndjson && outputFailed) {
      console.error("Could not write NDJSON output.");
      exitProcess(1);
      return;
    }
    await reportRunsFailure(error, stream, ndjson, controller.signal);
  } finally {
    if (ndjson) Deno.removeSignalListener("SIGINT", interrupt);
  }
}

/**
 * Successful command results are intentional API output, not diagnostic logs.
 * Preserve the contract payload, including event-token credentials.
 */
async function emitRunsResult(
  data: unknown,
  { stream, ndjson }: ReturnType<typeof parseRunsInvocation>,
  signal: AbortSignal,
): Promise<void> {
  if (ndjson) {
    await writeRunsJsonLine(createSuccessEnvelope(COMMAND, data), Deno.stdout, signal);
    return;
  }
  if (!isJsonMode()) {
    console.log(JSON.stringify(data, null, stream ? undefined : 2));
  } else if (stream) {
    streamJsonLine({ ...createSuccessEnvelope(COMMAND, data) });
  } else {
    await outputJson(createSuccessEnvelope(COMMAND, data));
  }
}

/** Await stdout backpressure and handle partial writes without retaining earlier items. */
export async function writeRunsJsonLine(
  envelope: unknown,
  writer: { write(bytes: Uint8Array): Promise<number> } = Deno.stdout,
  signal?: AbortSignal,
): Promise<void> {
  const bytes = new TextEncoder().encode(`${JSON.stringify(envelope)}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    signal?.throwIfAborted();
    const written = await writeWithSignal(writer, bytes.subarray(offset), signal);
    if (written <= 0) throw new Error("Output closed before the JSON line was written.");
    offset += written;
  }
}

async function writeWithSignal(
  writer: { write(bytes: Uint8Array): Promise<number> },
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<number> {
  if (!signal) return await writer.write(bytes);
  let interrupt: (() => void) | undefined;
  try {
    return await Promise.race([
      writer.write(bytes),
      new Promise<never>((_resolve, reject) => {
        interrupt = () => reject(signal.reason);
        signal.addEventListener("abort", interrupt, { once: true });
        if (signal.aborted) interrupt();
      }),
    ]);
  } finally {
    if (interrupt) signal.removeEventListener("abort", interrupt);
  }
}

function runsExitCode(problem: ReturnType<typeof runsProblemOf>, fallback: number | undefined) {
  if (!problem) return fallback ?? 1;
  return problem.status === 400 || problem.status === 422 ? 2 : 1;
}

async function reportRunsFailure(
  error: unknown,
  stream: boolean,
  ndjson = false,
  signal?: AbortSignal,
): Promise<void> {
  const problem = runsProblemOf(error);
  if (!problem && !(stream && (isJsonMode() || ndjson))) throw error;
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
  if (ndjson) {
    try {
      await writeRunsJsonLine(createErrorEnvelope(COMMAND, safe), Deno.stdout, signal);
    } catch {
      if (signal?.aborted) exitProcess(130);
      else {
        console.error("Could not write NDJSON output.");
        exitProcess(1);
      }
      return;
    }
  } else if (!isJsonMode()) {
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
    transport: createRunsApiTransport({
      baseUrl: apiUrl,
      getToken: () => token,
      retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      authMode: mode,
    }),
  });
}
