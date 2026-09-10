import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ExecutorOperation, ExecutorOperationContext } from "../executor/channel.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { createExecutorRuntimeInstallation } from "./executor-runtime-install.ts";
import {
  getExecutorRuntimeInstallSchema,
  parseExecutorInstallation,
} from "./executor-runtime-install-schema.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";

const binding = { allocationId: "allocation", invocationId: "invocation", generation: 1 };
const artifact = {
  version: 1,
  owner: { scopeKind: "global", serviceName: "veryfront-agent" },
  source: { type: "release", releaseId: "release-1" },
  root: "project",
} as const;
const grant = {
  agentId: "coder",
  defaultModelId: "model",
  maxSteps: 3,
  models: [{ id: "model", maxOutputTokens: 100, providerToolNames: [] }],
  allowedToolNames: [],
  hostToolFacadeIds: [],
  remoteToolSourceIds: [],
  execution: { kind: "ephemeral", projectId: null },
} as const;
function request(): JsonValue {
  return JSON.parse(
    JSON.stringify({ ...artifact, binding, grant, capabilities: { persistence: {} } }),
  );
}
function context(signal = new AbortController().signal): ExecutorOperationContext {
  return { binding, signal, deadline: Date.now() + 10_000 };
}
async function call(
  operations: ReadonlyMap<string, ExecutorOperation>,
  name: string,
  input: JsonValue,
  ctx = context(),
) {
  const operation = operations.get(name);
  if (operation?.mode !== "unary") throw new Error("Missing unary operation");
  return await operation.handle(input, ctx);
}
function runtime() {
  const ended = Promise.withResolvers<void>();
  let closes = 0;
  return {
    operations: new Map<string, ExecutorOperation>([
      ["discovery.describe", { mode: "unary", handle: () => ({ discovered: true }) }],
      ["agent.describe", { mode: "unary", handle: () => ({ described: true }) }],
      ["runtime.prepare", { mode: "unary", handle: () => ({ prepared: true }) }],
      ["agent.stream", {
        mode: "stream",
        async *handle() {
          yield { streamed: true };
        },
      }],
    ]),
    settled: ended.promise,
    close: () => {
      closes++;
      ended.resolve();
      return Promise.resolve();
    },
    get closes() {
      return closes;
    },
  };
}

describe("executor runtime installation", () => {
  it("observes retirement rejection while original cleanup remains pending", async () => {
    const cleanup = Promise.withResolvers<void>();
    const retirement = Promise.withResolvers<void>();
    const installation = createExecutorRuntimeInstallation({
      binding,
      artifact,
      install: () =>
        Promise.resolve({
          ...runtime(),
          close: () => cleanup.promise,
          settled: retirement.promise,
        }),
    });
    await call(installation.operations, "runtime.install", request());
    const closing = assertRejects(() => installation.close(), Error, "cleanup failed");
    try {
      retirement.reject(new Error("Synthetic retirement failure"));
      // Let unhandled-rejection reporting run while the independent cleanup is held.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    } finally {
      cleanup.resolve();
      await closing;
      await assertRejects(() => installation.settled);
    }
  });

  it("accepts host aliases only for the installed owner, source, and canonical tool", () => {
    const alias = {
      sourceId: "host",
      toolName: "owned-paper",
      ownerAgentId: "coder",
      shortName: "fetch-paper",
    };
    const input = {
      ...artifact,
      binding,
      grant: { ...grant, allowedToolNames: ["owned-paper"], hostToolFacadeIds: ["host"] },
      capabilities: { persistence: {} },
      hostToolAliases: [alias],
    };
    const parsed = parseExecutorInstallation(getExecutorRuntimeInstallSchema(), input);
    assertEquals(parsed.hostToolAliases, [alias]);
    for (
      const aliases of [
        [alias, alias],
        [{ ...alias, sourceId: "other" }],
        [{ ...alias, toolName: "fetch-paper" }],
        [{ ...alias, ownerAgentId: "other" }],
        [{ ...alias, shortName: "" }],
      ]
    ) {
      assertThrows(() =>
        parseExecutorInstallation(getExecutorRuntimeInstallSchema(), {
          ...input,
          hostToolAliases: aliases,
        })
      );
    }
  });

  it("registers fixed dispatch before bootstrap snapshots it, and imports only after authenticated installation", async () => {
    let imports = 0;
    const loaded = runtime();
    const owner = createExecutorRuntimeInstallation({
      binding,
      artifact,
      install: () => {
        imports++;
        return Promise.resolve(loaded);
      },
    });
    const operations = new Map(owner.operations);
    await assertRejects(() => call(operations, "discovery.describe", {}));
    assertEquals(imports, 0);
    assertEquals(await call(operations, "runtime.install", request()), { installed: true });
    assertEquals(imports, 1);
    assertEquals(await call(operations, "discovery.describe", {}), { discovered: true });
    await assertRejects(() => call(operations, "runtime.install", request()));
    await owner.close();
    await owner.settled;
    assertEquals(loaded.closes, 1);
  });

  it("rejects changed owner, source, root, binding and undeclared fields before project imports", async () => {
    let imports = 0;
    const owner = createExecutorRuntimeInstallation({
      binding,
      artifact,
      install: () => {
        imports++;
        return Promise.resolve(runtime());
      },
    });
    for (
      const change of [
        { owner: { scopeKind: "global", serviceName: "other" } },
        { source: { type: "release", releaseId: "other" } },
        { root: "/arbitrary" },
        { binding: { ...binding, generation: 2 } },
        { providerToken: "synthetic-marker" },
      ]
    ) {
      await assertRejects(() =>
        call(owner.operations, "runtime.install", {
          ...JSON.parse(JSON.stringify(request())),
          ...change,
        })
      );
    }
    await assertRejects(() =>
      call(owner.operations, "runtime.install", request(), {
        ...context(),
        binding: { ...binding, invocationId: "other" },
      })
    );
    assertEquals(imports, 0);
    await owner.close();
  });

  it("requires canonical persistence and project capabilities before importing", async () => {
    let imports = 0;
    const owner = createExecutorRuntimeInstallation({
      binding,
      artifact,
      install: () => {
        imports++;
        return Promise.resolve(runtime());
      },
    });
    const input = JSON.parse(JSON.stringify(request()));
    input.grant.execution = {
      kind: "canonical",
      projectId: "project-1",
      conversationId: "conversation",
      runId: "run",
      messageId: "message",
      providerReplay: "required",
    };
    await assertRejects(() => call(owner.operations, "runtime.install", input));
    input.capabilities = {
      persistence: {
        publishParentRunEvents: "events",
        toolExposureCheckpoint: "tools",
        providerReplayCheckpoint: "replay",
      },
    };
    await assertRejects(() => call(owner.operations, "runtime.install", input));
    assertEquals(imports, 0);
    input.capabilities.projectSteering = "steering";
    assertEquals(await call(owner.operations, "runtime.install", input), { installed: true });
    await owner.close();
  });

  it("revokes dispatch immediately while retaining late setup and cleanup until settled", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof runtime>>();
    const loaded = runtime();
    const owner = createExecutorRuntimeInstallation({
      binding,
      artifact,
      install: () => pending.promise,
    });
    const installation = call(owner.operations, "runtime.install", request());
    await assertRejects(() => call(owner.operations, "runtime.install", request()));
    const closing = owner.close();
    let settled = false;
    void owner.settled.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assertEquals(settled, false);
    await assertRejects(() => call(owner.operations, "discovery.describe", {}));
    pending.resolve(loaded);
    await assertRejects(() => installation);
    await closing;
    await owner.settled;
    assertEquals(loaded.closes, 1);
  });

  it("does not initialize when the installation request is already cancelled", async () => {
    let imports = 0;
    const owner = createExecutorRuntimeInstallation({
      binding,
      artifact,
      install: () => {
        imports++;
        return Promise.resolve(runtime());
      },
    });
    await assertRejects(() =>
      call(owner.operations, "runtime.install", request(), context(AbortSignal.abort()))
    );
    assertEquals(imports, 0);
    await owner.close();
  });

  it("retains an outstanding dispatched operation even after runtime cleanup acknowledges closure", async () => {
    const pending = Promise.withResolvers<JsonValue>();
    const loaded = runtime();
    loaded.operations.set("discovery.describe", { mode: "unary", handle: () => pending.promise });
    const owner = createExecutorRuntimeInstallation({
      binding,
      artifact,
      install: () => Promise.resolve(loaded),
    });
    await call(owner.operations, "runtime.install", request());
    const discovery = call(owner.operations, "discovery.describe", {});
    const closing = owner.close();
    let settled = false;
    void owner.settled.then(() => {
      settled = true;
    });
    await loaded.settled;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assertEquals(settled, false);
    pending.resolve({ discovered: true });
    await discovery;
    await closing;
    await owner.settled;
    assertEquals(settled, true);
  });
});
