import {
  allocatePort,
  assertCondition,
  ensureCommand,
  installDependencies,
  packNpmPackage,
  parseCommaSeparatedFlag,
  runChecked,
  type RuntimeName,
  scaffoldProject,
  startDevServer,
  stopDevServer,
  waitForRoute,
} from "./runtime-e2e-helpers.ts";

export type { RuntimeName } from "./runtime-e2e-helpers.ts";

export interface WorkflowRunDetail {
  id?: string;
  status?: string;
  input?: Record<string, unknown>;
  nodeStates?: Record<string, { status?: string; error?: unknown }>;
  error?: unknown;
}

type ProviderMode = "black-hole" | "respond";

const VALID_RUNTIMES: RuntimeName[] = ["node", "bun", "deno"];
const AGENT_MODEL = "anthropic/claude-haiku-4-5-20251001";
const ANTHROPIC_WIRE_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_API_KEY = "vf-runtime-critical-flow-key";
const WORKFLOW_ID = "content-pipeline";
const NODE_ID = "call-provider";
const APPLICATION_ROUTE_PAYLOAD = {
  ok: true,
  surface: "runtime-critical-flow",
};
const POLL_REQUEST_TIMEOUT_MS = 1_000;
const TERMINAL_STATUSES = new Set(["failed", "completed", "cancelled"]);

class UnexpectedTerminalRunError extends Error {}
class RunTerminatedBeforeProviderReceiptError extends Error {}

export function parseRuntimeSelection(args: string[]): RuntimeName[] {
  const requested = parseCommaSeparatedFlag(args, ["runtime", "runtimes"]);
  if (!requested) {
    return [...VALID_RUNTIMES];
  }

  const seen = new Set<string>();
  const runtimes: RuntimeName[] = [];
  for (const runtime of requested) {
    if (!VALID_RUNTIMES.includes(runtime as RuntimeName)) {
      throw new Error(`Unknown runtime: ${runtime}`);
    }
    if (seen.has(runtime)) {
      throw new Error(`Duplicate runtime: ${runtime}`);
    }
    seen.add(runtime);
    runtimes.push(runtime as RuntimeName);
  }

  return runtimes;
}

export function artifactClaim(runtime: RuntimeName): string {
  switch (runtime) {
    case "node":
      return "packed npm consumer";
    case "bun":
      return "packed package consumer";
    case "deno":
      return "packed CLI";
  }
}

function bodyContainsMarker(value: unknown, marker: string): boolean {
  if (typeof value === "string") {
    return value.includes(marker);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => bodyContainsMarker(entry, marker));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((entry) =>
      bodyContainsMarker(entry, marker)
    );
  }
  return false;
}

export async function validateAnthropicRequest(
  request: Request,
  expectedMarker: string,
): Promise<void> {
  await validateAnthropicRequestMarkers(request, [expectedMarker]);
}

async function validateAnthropicRequestMarkers(
  request: Request,
  expectedMarkers: string[],
): Promise<{ marker: string; stream: boolean }> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/v1/messages") {
    throw new Error(
      `Expected Anthropic request to be POST /v1/messages, got ${request.method} ${url.pathname}`,
    );
  }

  if (request.headers.get("x-api-key") !== ANTHROPIC_API_KEY) {
    throw new Error(
      "Anthropic request did not include the expected x-api-key header",
    );
  }

  if (request.headers.get("anthropic-version") !== "2023-06-01") {
    throw new Error(
      "Anthropic request did not include anthropic-version 2023-06-01",
    );
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]
    ?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new Error(
      `Anthropic request content-type must be application/json, got ${
        contentType ?? "missing"
      }`,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("Anthropic request body was not valid JSON");
  }

  const model = body && typeof body === "object"
    ? (body as { model?: unknown }).model
    : undefined;
  if (model !== ANTHROPIC_WIRE_MODEL) {
    throw new Error(
      `Expected Anthropic model ${ANTHROPIC_WIRE_MODEL}, got ${String(model)}`,
    );
  }

  const matchedMarker = expectedMarkers.find((marker) =>
    bodyContainsMarker(body, marker)
  );
  if (matchedMarker === undefined) {
    throw new Error(
      `Anthropic request body did not include marker ${
        expectedMarkers.join(" or ")
      }`,
    );
  }

  const stream = body && typeof body === "object"
    ? (body as { stream?: unknown }).stream === true
    : false;
  return { marker: matchedMarker, stream };
}

function isProviderValidationFailure(
  error: Error,
  state: ProviderState,
): boolean {
  return state.validationFailure() === error;
}

async function fetchWithTimeout(url: URL): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POLL_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForTerminalRun(
  url: URL,
  deadlineMs: number,
): Promise<WorkflowRunDetail> {
  const deadline = Date.now() + deadlineMs;
  let lastObservation = "none";

  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(url);
      const body = await response.text();
      if (!response.ok) {
        lastObservation = `HTTP ${response.status}: ${body.slice(0, 500)}`;
      } else {
        const detail = JSON.parse(body) as WorkflowRunDetail;
        lastObservation = JSON.stringify(detail).slice(0, 1_000);
        if (detail.status && TERMINAL_STATUSES.has(detail.status)) {
          if (detail.status !== "failed") {
            throw new UnexpectedTerminalRunError(
              `Run reached unexpected terminal status ${detail.status}: ${lastObservation}`,
            );
          }
          return detail;
        }
      }
    } catch (error) {
      if (
        error instanceof UnexpectedTerminalRunError
      ) {
        throw error;
      }
      lastObservation = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Run timed out before reaching terminal failure within ${deadlineMs}ms deadline; last observation: ${lastObservation}`,
  );
}

export function parseScopedResponseJson<T>(
  label: string,
  scope: "route/start" | "route/application-api" | "persistence/list",
  body: string,
): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(
      `${label} ${scope}: response was not JSON: ${body.slice(0, 500)}`,
    );
  }
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function parseProviderMode(args: string[]): ProviderMode {
  const value = parseCommaSeparatedFlag(args, ["provider-mode"])?.[0] ??
    "black-hole";
  if (value !== "black-hole" && value !== "respond") {
    throw new Error(`Unknown provider mode: ${value}`);
  }
  return value;
}

async function writeFixture(projectDir: string): Promise<void> {
  await Deno.remove(`${projectDir}/app/api/workflows`, { recursive: true })
    .catch(
      () => {},
    );
  await Deno.mkdir(`${projectDir}/app/api/workflows/[...path]`, {
    recursive: true,
  });
  await Deno.mkdir(`${projectDir}/app/api/ag-ui`, { recursive: true });
  await Deno.mkdir(`${projectDir}/app/api/critical-path`, { recursive: true });
  await Deno.mkdir(`${projectDir}/agents`, { recursive: true });
  await Deno.mkdir(`${projectDir}/lib`, { recursive: true });
  await Deno.mkdir(`${projectDir}/workflows`, { recursive: true });

  await Deno.writeTextFile(
    `${projectDir}/agents/content-agent.ts`,
    `import { agent } from "veryfront/agent";

export default agent({
  id: "content-agent",
  model: "${AGENT_MODEL}",
  system: "Return the marker you receive.",
  maxSteps: 1,
});
`,
  );
  await Deno.writeTextFile(
    `${projectDir}/workflows/content-pipeline.ts`,
    `import { agentStep, workflow } from "veryfront/workflow";
import { defineSchema } from "veryfront/schemas";

export default workflow({
  id: "${WORKFLOW_ID}",
  inputSchema: defineSchema((v) => v.object({ marker: v.string() }))(),
  steps: [
    agentStep("${NODE_ID}", "content-agent", {
      input: (context) => \`marker: \${(context.input as { marker: string }).marker}\`,
      timeout: "2s",
    }),
  ],
});
`,
  );
  await Deno.writeTextFile(
    `${projectDir}/lib/workflows.ts`,
    `import { getAgent, getAllAgentIds } from "veryfront/agent";
import { toolRegistry } from "veryfront/tool";
import { createWorkflowClient, MemoryBackend, type Workflow } from "veryfront/workflow";
import "../agents/content-agent.ts";
import contentPipeline from "../workflows/content-pipeline.ts";

const globalScope = globalThis as typeof globalThis & {
  runtimeCriticalFlowWorkflowClient?: ReturnType<typeof createWorkflowClient>;
};

export const workflows = globalScope.runtimeCriticalFlowWorkflowClient ??= createWorkflowClient({
  backend: new MemoryBackend(),
  executor: {
    stepExecutor: {
      agentRegistry: { get: getAgent, list: getAllAgentIds },
      toolRegistry,
    },
  },
});

workflows.register(contentPipeline as Workflow<unknown, unknown>);
`,
  );
  await Deno.writeTextFile(
    `${projectDir}/app/api/ag-ui/route.ts`,
    `import { createAgUiHandler } from "veryfront/agent";
import "../../../agents/content-agent.ts";

export const POST = createAgUiHandler("content-agent");
`,
  );
  await Deno.writeTextFile(
    `${projectDir}/app/api/critical-path/route.ts`,
    `export function GET(): Response {
  return Response.json(${JSON.stringify(APPLICATION_ROUTE_PAYLOAD)});
}
`,
  );
  await Deno.writeTextFile(
    `${projectDir}/app/api/workflows/[...path]/route.ts`,
    `import { createWorkflowHandler } from "veryfront/workflow";
import { workflows } from "../../../../lib/workflows.ts";

export const { GET, POST } = createWorkflowHandler(workflows);
`,
  );
}

interface ProviderState {
  received: string[];
  server: Deno.HttpServer;
  abort(): void;
  closed: Promise<void>;
  validationFailure(): Error | undefined;
  cancellationEvidence(): string | undefined;
  cancellation: Promise<string>;
  url: URL;
}

function stringifyError(value: unknown): string {
  return typeof value === "string" ? value : String(JSON.stringify(value));
}

export function parseAgUiTextDeltas(body: string): string[] {
  const deltas: string[] = [];
  for (const frame of body.split(/\r?\n\r?\n/)) {
    const lines = frame.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"))
      ?.slice("event:".length).trim();
    if (event !== "TextMessageContent") continue;

    const data = lines.filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart()).join("\n");
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new Error("AG-UI TextMessageContent event contained invalid JSON");
    }
    const delta = payload && typeof payload === "object"
      ? (payload as { delta?: unknown }).delta
      : undefined;
    if (typeof delta !== "string") {
      throw new Error("AG-UI TextMessageContent event omitted a string delta");
    }
    deltas.push(delta);
  }
  return deltas;
}

function anthropicStreamResponse(marker: string): Response {
  const messageId = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  const events = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          model: ANTHROPIC_WIRE_MODEL,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    ],
    [
      "content_block_start",
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    ],
    [
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: marker },
      },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ] as const;
  const body = events.map(([event, data]) =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  )
    .join("");

  return new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function anthropicJsonResponse(marker: string): Response {
  return Response.json({
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    type: "message",
    role: "assistant",
    model: ANTHROPIC_WIRE_MODEL,
    content: [{ type: "text", text: marker }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

export function assertListedRunFailure(
  label: string,
  list: { runs?: WorkflowRunDetail[] },
  runId: string,
): WorkflowRunDetail {
  const listed = list.runs?.find((run) => run.id === runId);
  if (listed === undefined) {
    throw new Error(
      `${label} persistence/list: failed run was not listed: ${
        JSON.stringify(list)
      }`,
    );
  }
  if (listed.status !== "failed") {
    throw new Error(
      `${label} persistence/list: listed run was not failed: ${
        JSON.stringify(listed)
      }`,
    );
  }

  const node = listed.nodeStates?.[NODE_ID];
  if (node?.status !== "failed") {
    throw new Error(
      `${label} persistence/list: ${NODE_ID} was not failed: ${
        JSON.stringify(listed)
      }`,
    );
  }

  const nodeError = stringifyError(node.error);
  assertCondition(
    nodeError.includes("timed out after 2000ms"),
    `${label} persistence/list: expected 2000ms timeout evidence for ${NODE_ID}, got ${nodeError}`,
  );

  return listed;
}

export async function waitForProviderCancellation(
  state: ProviderState,
  runtime: RuntimeName,
  timeoutMs = 1_500,
): Promise<void> {
  if (state.cancellationEvidence()) return;

  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () =>
        reject(
          new Error(
            `${runtime}/${
              artifactClaim(runtime)
            } provider/cancellation: provider request was not aborted by the client before cleanup within ${timeoutMs}ms`,
          ),
        ),
      timeoutMs,
    );
  });

  try {
    await Promise.race([state.cancellation, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function startProvider(
  agentMarker: string,
  workflowMarker: string,
  mode: ProviderMode,
): ProviderState {
  const received: string[] = [];
  const controller = new AbortController();
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let validationFailure: Error | undefined;
  let cancellationEvidence: string | undefined;
  let resolveCancellation!: (evidence: string) => void;
  const cancellation = new Promise<string>((resolve) => {
    resolveCancellation = resolve;
  });
  const pendingResponses = new Set<() => void>();
  const recordCancellation = (evidence: string) => {
    cancellationEvidence ??= evidence;
    resolveCancellation(cancellationEvidence);
  };
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
    onListen: () => {},
  }, async (request) => {
    let validated: { marker: string; stream: boolean };
    try {
      validated = await validateAnthropicRequestMarkers(request.clone(), [
        agentMarker,
        workflowMarker,
      ]);
    } catch (error) {
      validationFailure = error instanceof Error
        ? error
        : new Error(String(error));
      return Response.json({ error: validationFailure.message }, {
        status: 400,
      });
    }
    const { marker, stream } = validated;
    received.push(marker);

    if (marker === agentMarker || mode === "respond") {
      return stream
        ? anthropicStreamResponse(marker)
        : anthropicJsonResponse(marker);
    }

    return await new Promise<Response>((resolve) => {
      const release = () => resolve(new Response(null, { status: 499 }));
      const onClientAbort = () => {
        recordCancellation("client connection aborted provider request");
      };
      pendingResponses.add(release);
      controller.signal.addEventListener("abort", release, { once: true });
      if (request.signal.aborted) {
        onClientAbort();
      } else {
        request.signal.addEventListener("abort", onClientAbort, {
          once: true,
        });
      }
    });
  });

  server.finished.finally(resolveClosed);

  return {
    received,
    server,
    abort() {
      controller.abort();
      for (const release of pendingResponses) release();
      pendingResponses.clear();
    },
    closed,
    validationFailure() {
      return validationFailure;
    },
    cancellationEvidence() {
      return cancellationEvidence;
    },
    cancellation,
    url: new URL(`http://127.0.0.1:${server.addr.port}/v1`),
  };
}

export async function waitForProviderReceipt(
  state: ProviderState,
  runtime: RuntimeName,
  detailUrl: URL,
  expectedMarker?: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let lastRun = "none";
  while (Date.now() < deadline) {
    const validationFailure = state.validationFailure();
    if (validationFailure) throw validationFailure;
    if (
      expectedMarker === undefined
        ? state.received.length > 0
        : state.received.includes(expectedMarker)
    ) return;
    try {
      const response = await fetch(detailUrl, {
        signal: AbortSignal.timeout(1_000),
      });
      const body = await response.text();
      lastRun = `HTTP ${response.status}: ${body.slice(0, 1_000)}`;
      if (response.ok) {
        const detail = JSON.parse(body) as WorkflowRunDetail;
        const validationFailure = state.validationFailure();
        if (validationFailure) throw validationFailure;
        if (detail.status && TERMINAL_STATUSES.has(detail.status)) {
          if (
            expectedMarker === undefined
              ? state.received.length > 0
              : state.received.includes(expectedMarker)
          ) return;
          throw new RunTerminatedBeforeProviderReceiptError(
            `${runtime}/${
              artifactClaim(runtime)
            } provider/request: run terminated before provider receipt: ${
              JSON.stringify(detail)
            }`,
          );
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        isProviderValidationFailure(error, state)
      ) {
        throw error;
      }
      if (
        error instanceof RunTerminatedBeforeProviderReceiptError
      ) {
        throw error;
      }
      lastRun = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `${runtime}/${
      artifactClaim(runtime)
    } provider/request: provider was not reached; last run: ${lastRun}`,
  );
}

function scopedLogs(server: { stdout: string[]; stderr: string[] }): string {
  const stdout = server.stdout.join("").slice(-4_000).trim();
  const stderr = server.stderr.join("").slice(-4_000).trim();
  return [
    stdout ? `stdout:\n${stdout}` : "",
    stderr ? `stderr:\n${stderr}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function postJson(url: URL, body: unknown): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

async function assertApplicationPage(
  rootUrl: URL,
  label: string,
  scope: "route/page" | "server/post-timeout",
): Promise<void> {
  const response = await fetch(rootUrl, { signal: AbortSignal.timeout(5_000) });
  const body = await response.text();
  assertCondition(
    response.ok,
    `${label} ${scope}: root returned HTTP ${response.status}`,
  );
  assertCondition(
    body.includes("Content Pipeline"),
    `${label} ${scope}: root omitted expected application content`,
  );
}

async function assertApplicationApi(
  rootUrl: URL,
  label: string,
): Promise<void> {
  const response = await fetch(new URL("/api/critical-path", rootUrl), {
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.text();
  assertCondition(
    response.ok,
    `${label} route/application-api: HTTP ${response.status} ${
      body.slice(0, 500)
    }`,
  );
  const parsed = parseScopedResponseJson<Record<string, unknown>>(
    label,
    "route/application-api",
    body,
  );
  assertCondition(
    JSON.stringify(parsed) === JSON.stringify(APPLICATION_ROUTE_PAYLOAD),
    `${label} route/application-api: unexpected payload ${body.slice(0, 500)}`,
  );
}

async function assertAgentRoute(
  rootUrl: URL,
  label: string,
  marker: string,
): Promise<void> {
  const response = await postJson(new URL("/api/ag-ui", rootUrl), {
    messages: [{
      id: `message-${crypto.randomUUID()}`,
      role: "user",
      parts: [{ type: "text", text: marker }],
    }],
  });
  const body = await response.text();
  assertCondition(
    response.ok,
    `${label} route/agent: HTTP ${response.status} ${body.slice(0, 500)}`,
  );
  assertCondition(
    response.headers.get("content-type")?.includes("text/event-stream") ===
      true,
    `${label} route/agent: expected text/event-stream response`,
  );
  assertCondition(
    parseAgUiTextDeltas(body).join("").includes(marker),
    `${label} route/agent: assistant text omitted provider marker`,
  );
  assertCondition(
    body.includes("event: RunFinished"),
    `${label} route/agent: response omitted terminal RunFinished event`,
  );
}

async function assertRuntimeJourney(
  workDir: string,
  tarballPath: string,
  runtime: RuntimeName,
  providerMode: ProviderMode,
): Promise<void> {
  const label = `${runtime}/${artifactClaim(runtime)}`;
  const scenarioId = `${runtime}-${crypto.randomUUID()}`;
  const agentMarker = `runtime-critical-agent-${scenarioId}`;
  const workflowMarker = `runtime-critical-workflow-${scenarioId}`;
  const provider = startProvider(agentMarker, workflowMarker, providerMode);
  let server:
    | ReturnType<typeof startDevServer>
    | undefined;
  try {
    console.log(`${label}: scaffold`);
    const projectDir = await scaffoldProject(
      workDir,
      tarballPath,
      "agentic-workflow",
      runtime,
    );
    await writeFixture(projectDir);

    console.log(`${label}: install`);
    await installDependencies(projectDir, runtime, workDir);

    const port = allocatePort();
    server = startDevServer(projectDir, runtime, port, {
      ANTHROPIC_API_KEY,
      ANTHROPIC_BASE_URL: provider.url.toString(),
      VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS: "true",
    });

    const rootUrl = new URL(`http://127.0.0.1:${port}/`);
    console.log(`${label}: readiness ${rootUrl}`);
    await waitForRoute(rootUrl.toString(), 60_000);
    await assertApplicationPage(rootUrl, label, "route/page");
    await assertApplicationApi(rootUrl, label);
    await assertAgentRoute(rootUrl, label, agentMarker);
    assertCondition(
      provider.received.filter((marker) => marker === agentMarker).length === 1,
      `${label} provider/request: expected exactly one direct-agent request`,
    );

    const startUrl = new URL(`/api/workflows/${WORKFLOW_ID}/start`, rootUrl);
    const startedAt = Date.now();
    const startResponse = await postJson(startUrl, {
      input: { marker: workflowMarker },
    });
    const startBody = await startResponse.text();
    assertCondition(
      startResponse.ok,
      `${label} route/start: HTTP ${startResponse.status} ${
        startBody.slice(0, 500)
      }`,
    );
    const started = parseScopedResponseJson<{
      runId?: unknown;
      id?: unknown;
    }>(label, "route/start", startBody);
    const runId = started.runId ?? started.id;
    if (typeof runId !== "string" || runId.length === 0) {
      throw new Error(`${label} route/start: response omitted runId`);
    }
    const runIdString = runId;

    const detailUrl = new URL(`/api/workflows/runs/${runIdString}`, rootUrl);
    await waitForProviderReceipt(
      provider,
      runtime,
      detailUrl,
      workflowMarker,
    );
    assertCondition(
      provider.received.filter((marker) => marker === workflowMarker).length ===
        1,
      `${label} provider/request: expected exactly one workflow request`,
    );

    const detail = await waitForTerminalRun(
      detailUrl,
      10_000,
    );
    const elapsedMs = Date.now() - startedAt;

    if (providerMode === "respond") {
      throw new Error(
        `${label} negative control expected timeout failure, but provider-mode=respond should complete: ${
          JSON.stringify(detail)
        }`,
      );
    }

    assertCondition(
      detail.status === "failed",
      `${label} persistence/detail: run was not failed`,
    );
    const node = detail.nodeStates?.[NODE_ID];
    if (node?.status !== "failed") {
      throw new Error(
        `${label} persistence/detail: ${NODE_ID} was not failed: ${
          JSON.stringify(detail)
        }`,
      );
    }
    const nodeError = stringifyError(node.error);
    assertCondition(
      nodeError.includes("timed out after 2000ms"),
      `${label} timeout/cancellation: expected 2000ms timeout evidence, got ${nodeError}`,
    );
    assertCondition(
      elapsedMs >= 1_750 && elapsedMs < 10_000,
      `${label} timeout/cancellation: elapsed ${elapsedMs}ms outside expected bounds`,
    );
    await waitForProviderCancellation(provider, runtime);

    const listResponse = await fetch(
      new URL(`/api/workflows/runs?workflowId=${WORKFLOW_ID}`, rootUrl),
      { signal: AbortSignal.timeout(5_000) },
    );
    const listBody = await listResponse.text();
    assertCondition(
      listResponse.ok,
      `${label} persistence/list: HTTP ${listResponse.status} ${
        listBody.slice(0, 500)
      }`,
    );
    const list = parseScopedResponseJson<{ runs?: WorkflowRunDetail[] }>(
      label,
      "persistence/list",
      listBody,
    );
    assertListedRunFailure(label, list, runIdString);

    await assertApplicationPage(rootUrl, label, "server/post-timeout");
  } catch (error) {
    const logs = server ? scopedLogs(server) : "";
    throw new Error(
      [
        `${label} failed`,
        error instanceof Error ? error.message : String(error),
        logs,
      ].filter(Boolean).join("\n\n"),
    );
  } finally {
    if (server) await stopDevServer(server);
    provider.abort();
    await provider.server.shutdown().catch(() => {});
    await provider.closed.catch(() => {});
  }
}

export async function runRuntimeInferenceCriticalFlow(
  args = Deno.args,
): Promise<void> {
  const rootDir = new URL("../../", import.meta.url).pathname.replace(
    /\/$/,
    "",
  );
  const runtimes = parseRuntimeSelection(args);
  const providerMode = parseProviderMode(args);
  const keepWorkDir = hasFlag(args, "keep");
  const skipBuild = hasFlag(args, "skip-build");
  const workDir = await Deno.makeTempDir({
    prefix: "veryfront-runtime-critical-flow-",
  });

  console.log(`runtimes: ${runtimes.join(", ")}`);
  console.log(`provider mode: ${providerMode}`);

  try {
    await ensureCommand("npm");
    await ensureCommand("node");
    if (runtimes.includes("bun")) await ensureCommand("bun");
    if (runtimes.includes("deno")) await ensureCommand("deno");

    if (!skipBuild) {
      console.log("build npm package");
      await runChecked("deno", ["task", "build:npm"], {
        cwd: rootDir,
        timeoutMs: 300_000,
      });
    }

    console.log("pack npm package");
    const tarballPath = await packNpmPackage(rootDir, workDir);

    for (const runtime of runtimes) {
      await assertRuntimeJourney(
        workDir,
        tarballPath,
        runtime,
        providerMode,
      );
      console.log(`${runtime}/${artifactClaim(runtime)}: passed`);
    }
  } finally {
    if (keepWorkDir) {
      console.log(`kept work dir: ${workDir}`);
    } else {
      await Deno.remove(workDir, { recursive: true }).catch(() => {});
    }
  }
}

if (import.meta.main) {
  await runRuntimeInferenceCriticalFlow();
}
