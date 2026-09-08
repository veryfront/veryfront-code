import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { startNodeManagedAgentBroker } from "#veryfront/agent/service/managed-node-broker.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("managed node broker", () => {
  it("routes every required managed surface and preserves health contracts", async () => {
    const calls: Array<{ name: string; runId?: string; body: string }> = [];
    const handler = (name: string) => ({
      async handle(request: Request, input: { runId?: string }) {
        calls.push({
          name,
          ...(input.runId ? { runId: input.runId } : {}),
          body: await request.text(),
        });
        return Response.json({ name, runId: input.runId });
      },
    });
    const server = await startNodeManagedAgentBroker({
      port: 0,
      bindAddress: "127.0.0.1",
      signals: [],
      readiness: () => true,
      broker: {
        shutdown: () => Promise.resolve(),
        closed: Promise.resolve(),
        settled: Promise.resolve(),
      },
      handlers: {
        signedStream: handler("signed"),
        durableStart: handler("start"),
        agUi: handler("ag-ui"),
        cancel: handler("cancel"),
        resume: handler("resume"),
      },
    });
    try {
      assertEquals(await (await fetch(`${server.url}/liveness`)).text(), "OK");
      assertEquals(await (await fetch(`${server.url}/readiness`)).text(), "OK");
      for (
        const [method, path, body] of [
          ["POST", "/api/control-plane/runs/run-1/stream", "signed-body"],
          ["POST", "/api/runs", "start-body"],
          ["POST", "/api/ag-ui", "ag-ui-body"],
          ["DELETE", "/api/runs/run-2", ""],
          ["POST", "/api/runs/run-3/resume", "resume-direct"],
          ["DELETE", "/api/control-plane/runs/run-4", ""],
          ["POST", "/api/control-plane/runs/run-5/resume", "resume-control"],
        ]
      ) {
        const response = await fetch(`${server.url}${path}`, { method, body: body || undefined });
        assertEquals(response.status, 200);
        await response.body?.cancel();
      }
      assertEquals(calls, [
        { name: "signed", runId: "run-1", body: "signed-body" },
        { name: "start", body: "start-body" },
        { name: "ag-ui", body: "ag-ui-body" },
        { name: "cancel", runId: "run-2", body: "" },
        { name: "resume", runId: "run-3", body: "resume-direct" },
        { name: "cancel", runId: "run-4", body: "" },
        { name: "resume", runId: "run-5", body: "resume-control" },
      ]);
    } finally {
      await server.stop();
    }
  });

  it("stops admission before joining handler and broker retirement", async () => {
    const events: string[] = [];
    const retirement = Promise.withResolvers<void>();
    const shared = {
      handle: () => Promise.resolve(new Response("handled")),
      close: () => {
        events.push("handler-close");
      },
    };
    const server = await startNodeManagedAgentBroker({
      port: 0,
      bindAddress: "127.0.0.1",
      signals: [],
      readiness: () => true,
      broker: {
        shutdown() {
          events.push("broker-shutdown");
          return Promise.resolve();
        },
        closed: Promise.resolve(),
        settled: retirement.promise,
      },
      handlers: {
        signedStream: shared,
        durableStart: shared,
        agUi: shared,
        cancel: shared,
        resume: shared,
      },
    });
    let stopped = false;
    const stopping = server.stop().then(() => stopped = true);
    await tick();
    assertEquals(events[0], "broker-shutdown");
    assertEquals(stopped, false);
    retirement.resolve();
    await stopping;
    assertEquals(stopped, true);
    assertEquals(events, ["broker-shutdown", "handler-close"]);
  });

  it("rejects incomplete route configuration before binding", async () => {
    await assertRejects(() =>
      startNodeManagedAgentBroker({
        port: 0,
        signals: [],
        readiness: () => true,
        broker: {
          shutdown: () => Promise.resolve(),
          closed: Promise.resolve(),
          settled: Promise.resolve(),
        },
        handlers: {} as never,
      })
    );
  });

  it("keeps project loaders and agent factories outside its dependency graph", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      cwd: new URL("../../../", import.meta.url),
      args: ["info", "--frozen", "--json", "src/agent/service/managed-node-broker.ts"],
    }).output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    const graph = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      roots: string[];
      modules: Array<{ specifier: string; dependencies?: Array<{ code?: { specifier: string } }> }>;
    };
    const modules = new Map(graph.modules.map((module) => [module.specifier, module]));
    const visited = new Set<string>();
    const pending = [...graph.roots];
    while (pending.length) {
      const specifier = pending.shift()!;
      if (visited.has(specifier)) continue;
      visited.add(specifier);
      for (const dependency of modules.get(specifier)?.dependencies ?? []) {
        if (dependency.code) pending.push(dependency.code.specifier);
      }
    }
    const forbidden = [
      "/src/config/loader.ts",
      "/src/agent/factory.ts",
      "/src/tool/factory.ts",
      "/src/agent/project/agent-runtime.ts",
    ];
    assertEquals(
      [...visited].filter((specifier) => forbidden.some((path) => specifier.endsWith(path))),
      [],
    );
  });
});
