import { completeOnResponseBodyConsumption } from "#veryfront/platform/compat/http/response-lifecycle.ts";
import { retryWithBackoff } from "#veryfront/errors/error-handlers.ts";
import {
  type BoundedRetryConfig,
  requireVeryfrontApiRetryConfig,
} from "#veryfront/utils/config-resource-limits.ts";
import type { HandlerContext } from "#veryfront/types";
import {
  getHostApiOriginExcludingEnvFile,
  getHostEnv,
} from "#veryfront/platform/compat/process.ts";
import { resolveVeryfrontInferenceApiBaseUrlFromHostEnv } from "#veryfront/platform/cloud/resolver.ts";
import { createHostInternalOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import { cancelPrivateStream, getPrivateStreamReader } from "#veryfront/security/private-stream.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { requireSuccessResponseByteLimit } from "#veryfront/platform/adapters/veryfront-api-transport.ts";
import type { RunsCallOptions } from "#veryfront/runs/target/client.ts";
import {
  type ApplicationWorkflowRun,
  type ApplicationWorkflowRuns,
  withApplicationWorkflowRuns,
} from "#veryfront/runs/application-workflow-context.ts";
import { getApplicationWorkflowIdentity } from "./application-workflow-source.ts";

const NativeResponse = Response;
const NativeHeaders = Headers;
const freeze = Object.freeze;
const setPrototypeOf = Object.setPrototypeOf;
const randomUUID = crypto.randomUUID.bind(crypto);
const encodeBasic = globalThis.btoa.bind(globalThis);
const combineSignals = AbortSignal.any.bind(AbortSignal);
const NativeAbortController = AbortController;
const apply = Reflect.apply;
const bodyGetter = Object.getOwnPropertyDescriptor(Response.prototype, "body")!.get!;
const okGetter = Object.getOwnPropertyDescriptor(Response.prototype, "ok")!.get!;
const statusGetter = Object.getOwnPropertyDescriptor(Response.prototype, "status")!.get!;
const regExpExec = RegExp.prototype.exec;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const host = Object.freeze({
  getHostEnv,
  createOriginBoundFetch: createHostInternalOriginBoundOutboundFetch,
});

class HostedWorkflowHttpError extends Error {
  constructor(readonly status: number) {
    super(`Hosted workflow admission failed (HTTP ${status}).`);
  }
}

interface Proof {
  workflowId: string;
  requestId: string;
}

/** Install only the start and exact-run operations for this hosted API request. */
export function createHostApplicationWorkflowRunner(
  request: Request,
  ctx: HandlerContext,
  deps = host,
): (<T>(action: () => Promise<T>) => Promise<T>) | undefined {
  const identity = getApplicationWorkflowIdentity(ctx);
  if (!identity && (ctx.isLocalProject || !ctx.projectId || !ctx.projectSlug)) return undefined;
  const projectId = identity?.projectId;
  const projectSlug = identity?.projectSlug;
  const source = identity?.source;
  const user = identity && deps.getHostEnv("VERYFRONT_API_INTERNAL_USER");
  const pass = identity && deps.getHostEnv("VERYFRONT_API_INTERNAL_PASS");
  const origin = user && pass && source
    ? getHostApiOriginExcludingEnvFile("VERYFRONT_API_INTERNAL_URL") ??
      resolveVeryfrontInferenceApiBaseUrlFromHostEnv()
    : undefined;
  const transport = origin ? deps.createOriginBoundFetch(origin) : undefined;
  const headers = transport
    ? freeze(
      setPrototypeOf({
        authorization: `Basic ${encodeBasic(`${user}:${pass}`)}`,
        "content-type": "application/json",
      }, null),
    )
    : undefined;
  const requestSignal = request.signal;
  return async (action) => {
    const proofs = createPrivateMap<string, Proof>();
    const lifetime = new NativeAbortController();
    const baseSignal = combineSignals([requestSignal, lifetime.signal]);
    let active = true;
    let acceptingStarts = true;
    let startedWorkflow = false;
    const post = async (
      path: string,
      proof: Proof,
      retry: BoundedRetryConfig,
      input?: unknown,
      options?: RunsCallOptions,
    ) => {
      if (!active || !transport || !headers || !source) {
        throw new Error("Hosted workflow admission is unavailable for this request.");
      }
      const signal = options?.signal ? combineSignals([baseSignal, options.signal]) : baseSignal;
      signal.throwIfAborted();
      const maxBytes = requireSuccessResponseByteLimit(options?.maxResponseBytes);
      const { maxRetries, initialDelay, maxDelay } = requireVeryfrontApiRetryConfig(retry);
      const requestBody = privateJsonStringify({ projectId, projectSlug, source, ...proof, input });
      const response = await retryWithBackoff(async () => {
        const result = await transport(`${origin}/internal/application-workflows/runs${path}`, {
          method: "POST",
          redirect: "error",
          signal,
          headers,
          body: requestBody,
        });
        if (!apply(okGetter, result, [])) {
          const body = apply(bodyGetter, result, []) as ReadableStream<Uint8Array> | null;
          if (body) await cancelPrivateStream(body);
          throw new HostedWorkflowHttpError(apply(statusGetter, result, []));
        }
        return result;
      }, {
        maxAttempts: maxRetries + 1,
        initialDelay,
        maxDelay,
        abortSignal: signal,
        shouldRetry: (error) =>
          !(error instanceof HostedWorkflowHttpError) || error.status === 429 ||
          error.status >= 500,
      });
      const body = apply(bodyGetter, response, []) as ReadableStream<Uint8Array> | null;
      const result = await readResponseTextPrefix(
        { body: body ? { getReader: () => getPrivateStreamReader(body) } : null },
        maxBytes,
        signal,
        { fatalUtf8: true },
      );
      if (result.truncated) throw new Error("Hosted workflow response exceeded its limit.");
      const run = privateJsonParse(result.text) as ApplicationWorkflowRun;
      if (
        !run || typeof run.id !== "string" || !apply(regExpExec, uuid, [run.id]) ||
        run.project_id !== projectId || run.target?.type !== "workflow" ||
        run.target.id !== proof.workflowId
      ) {
        throw new Error("Invalid hosted workflow response.");
      }
      if (options?.onHeaders) {
        const etag = response.headers.get("etag");
        options.onHeaders(new NativeHeaders(etag ? { etag } : undefined));
      }
      return run;
    };
    const forRun = async (
      runId: string,
      operation: "read" | "cancel",
      retry: BoundedRetryConfig,
      options?: RunsCallOptions,
    ) => {
      const proof = proofs.get(runId);
      if (!proof) throw new Error("This workflow run was not started by this application request.");
      const run = await post(`/${runId}/${operation}`, proof, retry, undefined, options);
      if (run.id !== runId) throw new Error("Invalid hosted workflow run ID.");
      return run;
    };
    const runs: ApplicationWorkflowRuns = {
      owns: (id) => proofs.has(id),
      async start(input, retry) {
        if (!identity || !acceptingStarts) {
          throw new Error("Hosted workflow admission is unavailable for this request.");
        }
        if (input.projectId !== undefined && projectId !== input.projectId) {
          throw new Error("The workflow belongs to another project.");
        }
        if (
          input.publicId || input.parentRunId || input.toolCallId || input.nodeId ||
          input.runtimeTargetKind ||
          input.runtimeTargetBranchId || input.runtimeTargetEnvironmentId || input.startMode
        ) {
          throw new Error(
            "Hosted workflow runs use the project and source of the current application request.",
          );
        }
        const workflowId = input.workflowId;
        if (
          typeof workflowId !== "string" || !workflowId || input.target !== `workflow:${workflowId}`
        ) {
          throw new Error("Hosted workflow ID must match the workflow target.");
        }
        if (input.idempotencyKey !== undefined) {
          throw new Error(
            "Hosted workflow idempotencyKey requires an explicitly authenticated Runs client.",
          );
        }
        startedWorkflow = true;
        const proof = { workflowId, requestId: randomUUID() };
        const run = await post("", proof, retry, input.input);
        proofs.set(run.id, proof);
        return run;
      },
      read: (id, retry, options) => forRun(id, "read", retry, options),
      cancel: (id, retry) => forRun(id, "cancel", retry),
    };
    const release = () => {
      active = false;
      lifetime.abort();
    };
    let streaming = false;
    try {
      const result = await withApplicationWorkflowRuns(runs, action);
      acceptingStarts = false;
      if (startedWorkflow && result instanceof NativeResponse && result.body !== null) {
        // Deferred pulls may poll an admitted run, but returning headers closes new admissions.
        const response = completeOnResponseBodyConsumption(result, release, requestSignal, {
          highWaterMark: 0,
        }, {
          runDeferredOperation: (op) => withApplicationWorkflowRuns(runs, op),
          cancellationTimeoutMs: 0,
          errorOnAbort: true,
        });
        streaming = true;
        return response as typeof result;
      }
      return result;
    } finally {
      acceptingStarts = false;
      if (!streaming) release();
    }
  };
}
