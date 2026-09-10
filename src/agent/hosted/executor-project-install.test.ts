import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import type { ExecutorOperation, ExecutorOperationContext } from "../executor/channel.ts";
import { createExecutorRuntimeInstallation } from "./executor-runtime-install.ts";
import { EXECUTOR_TOOL_LIMITS } from "./executor-tool-schema.ts";

const binding = { allocationId: "allocation", invocationId: "invocation", generation: 1 };
const artifact = {
  version: 1,
  owner: { scopeKind: "global", serviceName: "synthetic-service" },
  source: { type: "release", releaseId: "synthetic-release" },
  root: "project",
} as const;
const request = {
  ...artifact,
  binding,
  mode: "project-tools",
  context: { agentId: "coder", projectId: "synthetic-project", runId: "synthetic-run" },
  allowedToolNames: ["inspect"],
  maxCalls: 32,
  maxConcurrent: 2,
} as const;
const context = (): ExecutorOperationContext => ({
  binding,
  signal: new AbortController().signal,
  deadline: Date.now() + 10_000,
});

async function call(
  operations: ReadonlyMap<string, ExecutorOperation>,
  name: string,
  value: unknown,
) {
  const operation = operations.get(name);
  if (operation?.mode !== "unary") throw new Error("Missing unary operation");
  return await operation.handle(value as JsonValue, context());
}
function fixture(pending?: Promise<void>) {
  let starts = 0;
  let closes = 0;
  const retired = Promise.withResolvers<void>();
  const operations = new Map<string, ExecutorOperation>([
    ["discovery.describe", { mode: "unary", handle: () => ({ discovered: true }) }],
    ["agent.describe", { mode: "unary", handle: () => ({ described: true }) }],
    ["project.tool-aliases", { mode: "unary", handle: () => ({ aliases: [] }) }],
    ...["tool.sources", "tool.list", "tool.execute"].map((name): [string, ExecutorOperation] => [
      name,
      {
        mode: "stream",
        async *handle() {
          await pending;
          yield { complete: true };
        },
      },
    ]),
  ]);
  const installation = createExecutorRuntimeInstallation({
    mode: "project-tools",
    binding,
    artifact,
    install: () => {
      starts++;
      return Promise.resolve({
        operations,
        settled: retired.promise,
        close: () => {
          closes++;
          retired.resolve();
          return Promise.resolve();
        },
      });
    },
  });
  return {
    installation,
    get starts() {
      return starts;
    },
    get closes() {
      return closes;
    },
  };
}

describe("project tool installation", () => {
  it("exposes only discovery and project tools after one authenticated installation", async () => {
    const f = fixture();
    try {
      for (
        const name of [
          "runtime.prepare",
          "agent.stream",
          "model.generate",
          "state.refresh",
          "persistence.append",
        ]
      ) {
        assertEquals(f.installation.operations.has(name), false);
      }
      await assertRejects(() => call(f.installation.operations, "agent.describe", {}));
      assertEquals(f.starts, 0);
      assertEquals(await call(f.installation.operations, "runtime.install", request), {
        installed: true,
      });
      assertEquals(await call(f.installation.operations, "agent.describe", {}), {
        described: true,
      });
      await assertRejects(() => call(f.installation.operations, "runtime.install", request));
      assertEquals(f.starts, 1);
    } finally {
      await f.installation.close();
    }
    assertEquals(f.closes, 1);
  });
  it("rejects credentials, privileged grants, invalid limits and wrong bindings before discovery", async () => {
    const f = fixture();
    try {
      for (
        const invalid of [
          { ...request, credentials: { token: "synthetic-token" } },
          { ...request, capabilities: { persistence: {} } },
          { ...request, grant: { models: [] } },
          { ...request, maxCalls: 4097 },
          { ...request, maxConcurrent: 33 },
          { ...request, limits: { ...EXECUTOR_TOOL_LIMITS, maxProgressEvents: 0 } },
          {
            ...request,
            limits: {
              ...EXECUTOR_TOOL_LIMITS,
              maxArgumentBytes: EXECUTOR_TOOL_LIMITS.maxArgumentBytes + 1,
            },
          },
          { ...request, limits: { ...EXECUTOR_TOOL_LIMITS, unrecognized: 1 } },
          { ...request, allowedToolNames: ["inspect", "inspect"] },
          { ...request, binding: { ...binding, generation: 2 } },
          { ...request, source: { type: "release", releaseId: "other" } },
          { ...request, context: { ...request.context, projectId: null } },
        ]
      ) await assertRejects(() => call(f.installation.operations, "runtime.install", invalid));
      assertEquals(f.starts, 0);
    } finally {
      await f.installation.close();
    }
  });
  it("retains an active project tool operation until original work settles during close", async () => {
    const work = Promise.withResolvers<void>();
    const f = fixture(work.promise);
    await call(f.installation.operations, "runtime.install", request);
    const execute = f.installation.operations.get("tool.execute");
    if (execute?.mode !== "stream") throw new Error("Missing project tool stream");
    const iterator = execute.handle({}, context())[Symbol.asyncIterator]();
    const next = iterator.next();
    let closed = false;
    const closing = f.installation.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(closed, false);
    work.resolve();
    await next;
    await iterator.return?.();
    await closing;
    assertEquals(f.closes, 1);
  });
});
