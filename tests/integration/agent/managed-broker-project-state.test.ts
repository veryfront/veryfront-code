import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createManagedBrokerProjectState } from "#veryfront/agent/hosted/managed-broker-project-state.ts";

const definition = {
  id: "coder",
  name: "Coder",
  description: "Codes",
  instructions: "Base instructions",
  skills: false as const,
};

describe("managed broker project state", () => {
  it("joins the original catalog lookup before propagating an instruction failure", async () => {
    const failure = new Error("synthetic instruction failure");
    const catalog = Promise.withResolvers<Response>();
    let listingCalls = 0;
    const state = createManagedBrokerProjectState({
      apiUrl: "https://api.example.test",
      authToken: "broker-token",
      agentId: "coder",
      projectId: "project-1",
      fetch: (value) => {
        const url = new URL(value);
        if (url.pathname.endsWith("/AGENTS.md")) return Promise.reject(failure);
        listingCalls++;
        return listingCalls === 1
          ? catalog.promise
          : Promise.resolve(Response.json({ data: [], page_info: { next: null } }));
      },
    });
    let rejected = false;
    const pending = state.prepareProjectSteering({
      definition,
      projectId: "project-1",
      signal: new AbortController().signal,
    }).catch((error) => {
      rejected = true;
      throw error;
    });
    void pending.catch(() => {});
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assertEquals(rejected, false);
    catalog.resolve(Response.json({ data: [], page_info: { next: null } }));
    assertStrictEquals(await assertRejects(() => pending), failure);
  });

  it("uses fixed project authorization and performs a complete refresh", async () => {
    const calls: Array<{ url: URL; authorization: string | null }> = [];
    let instructionRead = 0;
    const fetch = (value: string, init: RequestInit) => {
      const url = new URL(value);
      calls.push({ url, authorization: new Headers(init.headers).get("authorization") });
      if (url.pathname.endsWith("/AGENTS.md")) {
        instructionRead++;
        return Promise.resolve(Response.json({
          path: "AGENTS.md",
          content: `Project instructions ${instructionRead}`,
        }));
      }
      return Promise.resolve(Response.json({ data: [], page_info: { next: null } }));
    };
    const state = createManagedBrokerProjectState({
      apiUrl: "https://api.example.test",
      authToken: "broker-token",
      agentId: "coder",
      projectId: "project-1",
      branchId: "branch-1",
      fetch,
    });
    const prepared = await state.prepareProjectSteering({
      definition,
      projectId: "project-1",
      branchId: "branch-1",
      signal: new AbortController().signal,
    });
    assertEquals(prepared.initialProjectInstructions, "Project instructions 1");
    const refreshed = await state.refreshProjectSteering(new AbortController().signal);
    assertEquals(JSON.stringify(refreshed).includes("Project instructions 2"), true);
    assertEquals(calls.every((call) => call.authorization === "Bearer broker-token"), true);
    assertEquals(calls.every((call) => call.url.origin === "https://api.example.test"), true);
    await assertRejects(() =>
      state.prepareProjectSteering({
        definition,
        projectId: "project-2",
        branchId: "branch-1",
        signal: new AbortController().signal,
      })
    );
  });

  it("uses no API lookup for a null project and forwards conversation cancellation", async () => {
    let fetches = 0;
    let conversationSignal: AbortSignal | undefined;
    const state = createManagedBrokerProjectState({
      apiUrl: "https://api.example.test",
      authToken: "broker-token",
      agentId: "coder",
      projectId: null,
      fetch: () => {
        fetches++;
        return Promise.reject(new Error("must not fetch"));
      },
      latestConversationUserText: (signal) => {
        conversationSignal = signal;
        return Promise.resolve(null);
      },
    });
    const prepared = await state.prepareProjectSteering({
      definition,
      projectId: null,
      signal: new AbortController().signal,
    });
    assertEquals(prepared.agent.id, "coder");
    await state.refreshProjectSteering(new AbortController().signal);
    const controller = new AbortController();
    controller.abort();
    await assertRejects(() => state.latestConversationUserText!(controller.signal));
    assertEquals(conversationSignal, undefined);
    assertEquals(fetches, 0);
  });

  it("cancels in-flight project helper reads", async () => {
    const entered = Promise.withResolvers<AbortSignal>();
    const state = createManagedBrokerProjectState({
      apiUrl: "https://api.example.test",
      authToken: "broker-token",
      agentId: "coder",
      projectId: "project-1",
      fetch: (_url, init) => {
        const signal = init.signal!;
        entered.resolve(signal);
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });
    const controller = new AbortController();
    const pending = state.prepareProjectSteering({
      definition,
      projectId: "project-1",
      signal: controller.signal,
    });
    const signal = await entered.promise;
    controller.abort();
    await assertRejects(() => pending);
    assertEquals(signal.aborted, true);
  });

  it("keeps local discovery and factories outside its dependency graph", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      cwd: new URL("../../../", import.meta.url),
      args: ["info", "--frozen", "--json", "src/agent/hosted/managed-broker-project-state.ts"],
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
      "/src/agent/hosted/executor-discovery-node.ts",
    ];
    assertEquals(
      [...visited].filter((specifier) => forbidden.some((path) => specifier.endsWith(path))),
      [],
    );
  });
});
