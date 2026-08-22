import type { RuntimeName } from "./template-runtime-e2e.ts";
import {
  assertCondition,
  ensureCommand,
  installDependencies,
  packNpmPackage,
  runChecked,
  scaffoldProject,
  startDevServer,
  stopDevServer,
  waitForRoute,
} from "./template-runtime-e2e.ts";

export type { RuntimeName } from "./template-runtime-e2e.ts";

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
const POLL_REQUEST_TIMEOUT_MS = 1_000;
const TERMINAL_STATUSES = new Set(["failed", "completed", "cancelled"]);

function parseCsvFlag(args: string[], names: string[]): string[] | null {
  for (const name of names) {
    const prefix = `--${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    if (inline) {
      return inline.slice(prefix.length).split(",").map((value) => value.trim())
        .filter(Boolean);
    }

    const index = args.indexOf(`--${name}`);
    if (index >= 0) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`--${name} requires a comma-separated value`);
      }
      return value.split(",").map((entry) => entry.trim()).filter(Boolean);
    }
  }

  return null;
}

export function parseRuntimeSelection(args: string[]): RuntimeName[] {
  const requested = parseCsvFlag(args, ["runtime", "runtimes"]);
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

  if (!bodyContainsMarker(body, expectedMarker)) {
    throw new Error(
      `Anthropic request body did not include marker ${expectedMarker}`,
    );
  }
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
            throw new Error(
              `Run reached unexpected terminal status ${detail.status}: ${lastObservation}`,
            );
          }
          return detail;
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("unexpected terminal status")
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

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function parseProviderMode(args: string[]): ProviderMode {
  const value = parseCsvFlag(args, ["provider-mode"])?.[0] ?? "black-hole";
  if (value !== "black-hole" && value !== "respond") {
    throw new Error(`Unknown provider mode: ${value}`);
  }
  return value;
}

function allocatePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function writeFixture(projectDir: string): Promise<void> {
  await Deno.remove(`${projectDir}/app/api/workflows`, { recursive: true })
    .catch(
      () => {},
    );
  await Deno.mkdir(`${projectDir}/app/api/workflows/[...path]`, {
    recursive: true,
  });
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
    `${projectDir}/app/api/workflows/[...path]/route.ts`,
    `import { createWorkflowHandler } from "veryfront/workflow";
import { workflows } from "../../../../lib/workflows.ts";

export const { GET, POST } = createWorkflowHandler(workflows);
`,
  );
}

interface ProviderState {
  received: Request[];
  server: Deno.HttpServer;
  abort(): void;
  closed: Promise<void>;
  validationFailure(): Error | undefined;
  url: URL;
}

function startProvider(
  expectedMarker: string,
  mode: ProviderMode,
): ProviderState {
  const received: Request[] = [];
  const controller = new AbortController();
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let validationFailure: Error | undefined;
  const pendingResponses = new Set<() => void>();
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
    onListen: () => {},
  }, async (request) => {
    try {
      await validateAnthropicRequest(request.clone(), expectedMarker);
    } catch (error) {
      validationFailure = error instanceof Error
        ? error
        : new Error(String(error));
      return Response.json({ error: validationFailure.message }, {
        status: 400,
      });
    }
    received.push(request.clone());

    if (mode === "respond") {
      return Response.json({
        id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
        type: "message",
        role: "assistant",
        model: ANTHROPIC_WIRE_MODEL,
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    }

    return await new Promise<Response>((resolve) => {
      const release = () => resolve(new Response(null, { status: 499 }));
      pendingResponses.add(release);
      controller.signal.addEventListener("abort", release, { once: true });
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
    url: new URL(`http://127.0.0.1:${server.addr.port}/v1`),
  };
}

export async function waitForProviderReceipt(
  state: ProviderState,
  runtime: RuntimeName,
  detailUrl: URL,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let lastRun = "none";
  while (Date.now() < deadline) {
    const validationFailure = state.validationFailure();
    if (validationFailure) throw validationFailure;
    if (state.received.length > 0) return;
    try {
      const response = await fetch(detailUrl, {
        signal: AbortSignal.timeout(1_000),
      });
      const body = await response.text();
      lastRun = `HTTP ${response.status}: ${body.slice(0, 1_000)}`;
      if (response.ok) {
        const detail = JSON.parse(body) as WorkflowRunDetail;
        if (detail.status && TERMINAL_STATUSES.has(detail.status)) {
          if (state.received.length > 0) return;
          throw new Error(
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
        error.message.includes("run terminated before provider receipt")
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

async function assertRuntimeJourney(
  rootDir: string,
  workDir: string,
  tarballPath: string,
  runtime: RuntimeName,
  providerMode: ProviderMode,
): Promise<void> {
  const label = `${runtime}/${artifactClaim(runtime)}`;
  const marker = `runtime-critical-flow-${runtime}-${crypto.randomUUID()}`;
  const provider = startProvider(marker, providerMode);
  let server:
    | ReturnType<typeof startDevServer>
    | undefined;
  const previousEnv = {
    ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY"),
    ANTHROPIC_BASE_URL: Deno.env.get("ANTHROPIC_BASE_URL"),
    VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS: Deno.env.get(
      "VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS",
    ),
  };

  try {
    console.log(`${label}: scaffold`);
    const projectDir = await scaffoldProject(
      rootDir,
      workDir,
      tarballPath,
      "agentic-workflow",
      runtime,
    );
    await writeFixture(projectDir);

    console.log(`${label}: install`);
    await installDependencies(projectDir, runtime, workDir);

    const port = allocatePort();
    Deno.env.set("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY);
    Deno.env.set("ANTHROPIC_BASE_URL", provider.url.toString());
    Deno.env.set("VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS", "true");
    server = startDevServer(projectDir, runtime, port);

    const rootUrl = new URL(`http://127.0.0.1:${port}/`);
    console.log(`${label}: readiness ${rootUrl}`);
    await waitForRoute(rootUrl.toString(), 60_000);

    const startUrl = new URL(`/api/workflows/${WORKFLOW_ID}/start`, rootUrl);
    const startResponse = await postJson(startUrl, { input: { marker } });
    const started = await startResponse.json() as {
      runId?: unknown;
      id?: unknown;
    };
    const runId = started.runId ?? started.id;
    assertCondition(
      startResponse.ok,
      `${label} route/start: HTTP ${startResponse.status} ${
        JSON.stringify(started)
      }`,
    );
    assertCondition(
      typeof runId === "string" && runId.length > 0,
      `${label} route/start: response omitted runId`,
    );

    const detailUrl = new URL(`/api/workflows/runs/${runId}`, rootUrl);
    await waitForProviderReceipt(provider, runtime, detailUrl);
    assertCondition(
      provider.received.length === 1,
      `${label} provider/request: expected exactly one request, got ${provider.received.length}`,
    );

    const startedAt = Date.now();
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
    const nodeError = typeof node.error === "string"
      ? node.error
      : JSON.stringify(node.error);
    assertCondition(
      nodeError.includes("timed out after 2000ms"),
      `${label} timeout/cancellation: expected 2000ms timeout evidence, got ${nodeError}`,
    );
    assertCondition(
      elapsedMs >= 1_750 && elapsedMs < 10_000,
      `${label} timeout/cancellation: elapsed ${elapsedMs}ms outside expected bounds`,
    );

    const listResponse = await fetch(
      new URL(`/api/workflows/runs?workflowId=${WORKFLOW_ID}`, rootUrl),
      { signal: AbortSignal.timeout(5_000) },
    );
    const list = await listResponse.json() as { runs?: WorkflowRunDetail[] };
    const listed = list.runs?.find((run) => run.id === runId);
    assertCondition(
      listResponse.ok,
      `${label} persistence/list: HTTP ${listResponse.status}`,
    );
    assertCondition(
      listed?.status === "failed",
      `${label} persistence/list: failed run was not listed: ${
        JSON.stringify(list)
      }`,
    );

    const health = await fetch(rootUrl, { signal: AbortSignal.timeout(5_000) });
    await health.body?.cancel();
    assertCondition(
      health.ok,
      `${label} server/post-timeout: root returned HTTP ${health.status}`,
    );
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
    if (previousEnv.ANTHROPIC_API_KEY === undefined) {
      Deno.env.delete("ANTHROPIC_API_KEY");
    } else {
      Deno.env.set("ANTHROPIC_API_KEY", previousEnv.ANTHROPIC_API_KEY);
    }
    if (previousEnv.ANTHROPIC_BASE_URL === undefined) {
      Deno.env.delete("ANTHROPIC_BASE_URL");
    } else {
      Deno.env.set("ANTHROPIC_BASE_URL", previousEnv.ANTHROPIC_BASE_URL);
    }
    if (previousEnv.VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS === undefined) {
      Deno.env.delete("VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS");
    } else {
      Deno.env.set(
        "VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS",
        previousEnv.VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS,
      );
    }
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
        rootDir,
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
