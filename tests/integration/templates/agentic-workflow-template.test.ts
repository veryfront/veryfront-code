import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import type { WorkflowRunSummary } from "#veryfront/workflow";
import { registerModelProvider } from "#veryfront/provider/model-registry.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";

import { getTemplate } from "../../../templates/index.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { createTestDenoConfig } from "../../_helpers/import-maps.ts";

async function scaffoldTemplate(
  projectDir: string,
  templateName: "agentic-workflow",
): Promise<void> {
  const files = await getTemplate(templateName);
  if (!files) {
    throw new Error(`Template ${templateName} was not found`);
  }

  for (const file of files) {
    const targetPath = join(projectDir, file.path);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeTextFile(targetPath, file.content);
  }
}

/** Answer every agent call with fixed text, so no step needs a model key. */
const stubModel: ModelRuntime = {
  provider: "openai",
  modelId: "stub",
  specificationVersion: "v3",
  doGenerate: () =>
    Promise.resolve({
      content: [{ type: "text", text: "Stub notes." }],
      finishReason: { unified: "stop", raw: "stop" },
    }),
  doStream: () =>
    Promise.resolve({
      stream: ReadableStream.from([
        { type: "text-delta", delta: "Stub notes." },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" } },
      ]),
    }),
};

async function readCsrfToken(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/`, { headers: { accept: "text/html" } });
  await response.text();
  for (const cookie of response.headers.getSetCookie()) {
    const token = /^__Host-vf_csrf=([^;]+)/.exec(cookie)?.[1];
    if (token) return token;
  }
  return "";
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Response> {
  const token = await readCsrfToken(baseUrl);
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { cookie: `__Host-vf_csrf=${token}`, "x-csrf-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function waitForRun(
  baseUrl: string,
  runId: string,
  done: (run: WorkflowRunSummary) => boolean,
): Promise<WorkflowRunSummary> {
  const deadline = Date.now() + 30_000;
  let run: WorkflowRunSummary | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/workflows/runs/${runId}`);
    assertEquals(response.status, 200);
    run = await response.json() as WorkflowRunSummary;
    if (done(run)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Run ${runId} never settled: ${JSON.stringify(run)}`);
}

function nodeStatuses(run: WorkflowRunSummary): Record<string, string> {
  return Object.fromEntries(
    Object.entries(run.nodeStates).map(([nodeId, node]) => [nodeId, node.status]),
  );
}

describe("agentic-workflow template integration", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it("renders the dashboard and workflow detail routes without workflow executor import errors", async () => {
    await withTestContext("agentic-workflow-template", async (context) => {
      await writeTextFile(join(context.projectDir, "deno.json"), createTestDenoConfig());
      await scaffoldTemplate(context.projectDir, "agentic-workflow");

      const port = await context.allocatePort();
      const server = await context.startDevServer({ port, enableHMR: false });

      const dashboardResponse = await fetch(`http://127.0.0.1:${server.port}/`);
      assertEquals(dashboardResponse.status, 200);
      const dashboardHtml = await dashboardResponse.text();
      assert(dashboardHtml.includes("Content Pipeline"));
      assert(dashboardHtml.includes("Recent Runs"));
      assert(!dashboardHtml.includes("workflow-executor.ts"));
      assert(!dashboardHtml.includes("Module not found"));

      const detailResponse = await fetch(`http://127.0.0.1:${server.port}/workflows/test-run`);
      assertEquals(detailResponse.status, 200);
      const detailHtml = await detailResponse.text();
      assert(detailHtml.includes("Loading workflow") || detailHtml.includes("Workflow not found"));
      assert(!detailHtml.includes("workflow-executor.ts"));
      assert(!detailHtml.includes("Module not found"));
    });
  });

  it("executes a started run, pauses at the approval gate, and resumes on approval", async () => {
    const unregister = registerModelProvider("openai", () => stubModel);
    try {
      await withTestContext("agentic-workflow-template-run", async (context) => {
        await writeTextFile(join(context.projectDir, "deno.json"), createTestDenoConfig());
        await scaffoldTemplate(context.projectDir, "agentic-workflow");

        const port = await context.allocatePort();
        const server = await context.startDevServer({ port, enableHMR: false });
        const baseUrl = `http://127.0.0.1:${server.port}`;

        const startResponse = await postJson(baseUrl, "/api/workflows/content-pipeline/start", {
          input: { topic: "Tide pools" },
        });
        assertEquals(startResponse.status, 200);
        const { runId } = await startResponse.json() as { runId: string };

        const waiting = await waitForRun(baseUrl, runId, (run) => run.status !== "running");
        assertEquals(waiting.status, "waiting");
        assertEquals(nodeStatuses(waiting), {
          research: "completed",
          draft: "completed",
          "draft/write-article": "completed",
          "draft/write-summary": "completed",
          "editorial-review": "running",
        });
        const [approval] = waiting.pendingApprovals;
        assertEquals(approval?.nodeId, "editorial-review");

        const listResponse = await fetch(`${baseUrl}/api/workflows/runs`);
        const { runs } = await listResponse.json() as { runs: WorkflowRunSummary[] };
        assertEquals(runs.map((run) => run.id), [runId]);

        const approveResponse = await postJson(
          baseUrl,
          `/api/workflows/runs/${runId}/approvals/${approval!.id}`,
          { approved: true, approver: "user" },
        );
        assertEquals(approveResponse.status, 200);

        const completed = await waitForRun(baseUrl, runId, (run) => run.status !== "waiting");
        assertEquals(completed.status, "completed");
        assertEquals(completed.pendingApprovals, []);
        assertEquals(completed.nodeStates.publish?.status, "completed");
      });
    } finally {
      unregister();
    }
  });
});
