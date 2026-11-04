import "#veryfront/testing/init.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { discoverAll } from "#veryfront/discovery/index.ts";
import { createProjectDiscoveryConfig } from "#veryfront/discovery/project-discovery-config.ts";
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import type { Agent, AgentConfig } from "#veryfront/agent/types.ts";
import { createToolsFromRemoteDefinitions } from "#veryfront/tool/remote-source-tools.ts";
import {
  intersectSourceIntegrationPolicies,
  isIntegrationToolAllowedBySourcePolicy,
  normalizeSourceIntegrationPolicy,
  parseSourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import {
  collectDeclaredIntegrations,
  findUnconnectedIntegrationLines,
  normalizeIntegrationPolicyForDiagnostics,
  snapshotIntegrationDiagnostics as captureIntegrationDiagnostics,
  suppliesToolsFromSources,
  unconnectedIntegrationLines,
} from "../../../../cli/commands/dev/unconnected-integrations.ts";

import {
  __resetLoggerConfigForTests,
  __subscribeLogRecordEmitter,
  LogLevel,
  setLogLevel,
} from "#veryfront/utils/logger/logger.ts";

const snapshotIntegrationDiagnostics = (
  config: Parameters<typeof captureIntegrationDiagnostics>[0],
  target: Parameters<typeof captureIntegrationDiagnostics>[1] = {
    authToken: "token",
    projectSlug: "case-demo",
  },
) => captureIntegrationDiagnostics(config, target);

const config = { ai: { agents: { discovery: { paths: ["crew"] } } } };

describe("dev integration source discovery", () => {
  it("formats enabled tool warnings without replaceable array methods", () => {
    const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
    const join = Array.prototype.join;
    const slice = Array.prototype.slice;
    let lines: string[] | undefined;
    try {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        value: () => {
          throw new Error("project iterator");
        },
        configurable: true,
      });
      Array.prototype.join = () => {
        throw new Error("project join");
      };
      Array.prototype.slice = () => {
        throw new Error("project slice");
      };
      const declared = collectDeclaredIntegrations([
        { agentId: "b", tools: { salesforce__get_case: true } },
        { agentId: "a", tools: { salesforce__update_case: true, gmail__delete_email: false } },
      ]);
      lines = unconnectedIntegrationLines(declared, [], "case-demo");
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, iterator);
      Array.prototype.join = join;
      Array.prototype.slice = slice;
    }
    assertEquals(lines, [
      "Salesforce isn't connected. Agents a and b need it.",
      "  Connect: npx veryfront integration connect salesforce --project case-demo",
    ]);
  });
  it("still warns when config replaces collection built-ins before normalization", () => {
    const sort = Array.prototype.sort;
    const iterator = Array.prototype[Symbol.iterator];
    const add = Set.prototype.add;
    let lines: string[] | undefined;
    let policy: ReturnType<typeof normalizeIntegrationPolicyForDiagnostics>;
    const fail = () => {
      throw new Error("project collection replacement");
    };
    try {
      Array.prototype.sort = fail;
      Array.prototype[Symbol.iterator] = fail;
      Set.prototype.add = fail;
      policy = normalizeIntegrationPolicyForDiagnostics({
        allow: { gmail: {}, salesforce: { allowedTools: ["update_case", "get_case", "get_case"] } },
      });
      lines = unconnectedIntegrationLines(
        collectDeclaredIntegrations([
          { agentId: "case-agent", tools: { salesforce__get_case: true } },
        ], policy ?? undefined),
        [],
        "case-demo",
      );
    } finally {
      Array.prototype.sort = sort;
      Array.prototype[Symbol.iterator] = iterator;
      Set.prototype.add = add;
    }
    assertEquals(policy, {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: {
        gmail: { allowedToolIds: null },
        salesforce: { allowedToolIds: ["get_case", "update_case"] },
      },
    });
    assertEquals(lines, [
      "Salesforce isn't connected. Agent case-agent needs it.",
      "  Connect: npx veryfront integration connect salesforce --project case-demo",
    ]);
  });

  it("keeps policy entries and warnings when inherited integration setters throw", () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "gmail");
    let policy: ReturnType<typeof normalizeIntegrationPolicyForDiagnostics>;
    let parsed: ReturnType<typeof parseSourceIntegrationPolicyManifest>;
    let intersected: ReturnType<typeof intersectSourceIntegrationPolicies>;
    let lines: string[] | undefined;
    try {
      Object.defineProperty(Object.prototype, "gmail", {
        configurable: true,
        set() {
          throw new Error("project integration setter");
        },
      });
      policy = normalizeIntegrationPolicyForDiagnostics({ allow: { gmail: {} } });
      parsed = parseSourceIntegrationPolicyManifest({
        schemaVersion: 1,
        mode: "allowlist",
        integrations: { gmail: { allowedToolIds: null } },
      });
      intersected = intersectSourceIntegrationPolicies(policy, parsed);
      lines = unconnectedIntegrationLines(
        collectDeclaredIntegrations([
          { agentId: "mail-agent", tools: { gmail__list_emails: true } },
        ], intersected),
        [],
        "mail-demo",
      );
    } finally {
      if (original) Object.defineProperty(Object.prototype, "gmail", original);
      else Reflect.deleteProperty(Object.prototype, "gmail");
    }
    const expected = {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: { gmail: { allowedToolIds: null } },
    } as const;
    assertEquals(policy, expected);
    assertEquals(parsed, expected);
    assertEquals(intersected, expected);
    assertEquals(lines, [
      "Gmail isn't connected. Agent mail-agent needs it.",
      "  Connect: npx veryfront integration connect gmail --project mail-demo",
    ]);
  });

  for (const throws of [false, true]) {
    it(`ignores inherited integration getters that ${throws ? "throw" : "fabricate grants"}`, () => {
      const policy = normalizeSourceIntegrationPolicy({ allow: { gmail: {} } });
      const other = normalizeSourceIntegrationPolicy({ allow: { salesforce: {} } });
      const original = Object.getOwnPropertyDescriptor(Object.prototype, "salesforce");
      let allowed: boolean | undefined;
      let intersected: ReturnType<typeof intersectSourceIntegrationPolicies> | undefined;
      let getterCalls = 0;
      try {
        Object.defineProperty(Object.prototype, "salesforce", {
          configurable: true,
          get() {
            getterCalls++;
            if (throws) throw new Error("project integration getter");
            return { allowedToolIds: null };
          },
        });
        allowed = isIntegrationToolAllowedBySourcePolicy("salesforce__get_case", policy);
        intersected = intersectSourceIntegrationPolicies(other, policy);
      } finally {
        if (original) Object.defineProperty(Object.prototype, "salesforce", original);
        else Reflect.deleteProperty(Object.prototype, "salesforce");
      }
      assertEquals(allowed, false);
      assertEquals(intersected, { schemaVersion: 1, mode: "allowlist", integrations: {} });
      assertEquals(getterCalls, 0);
    });
  }

  it("cannot tell what an agent's own tool sources supply, so it does not warn for them", () => {
    const agentConfig = (extra: Record<string, unknown> = {}) =>
      ({ id: "a", system: "", ...extra }) as unknown as AgentConfig;
    assertEquals(suppliesToolsFromSources(agentConfig()), false);
    assertEquals(suppliesToolsFromSources(agentConfig({ mcpServers: [] })), false);
    assertEquals(
      suppliesToolsFromSources(agentConfig({ mcpServers: [{ kind: "veryfront-api" }] })),
      true,
    );
    assertEquals(
      collectDeclaredIntegrations([
        { agentId: "mcp-agent", tools: { salesforce__get_case: true }, hasToolSources: true },
        { agentId: "plain-agent", tools: { salesforce__get_case: true } },
      ]),
      [{ integration: "salesforce", agentIds: ["plain-agent"] }],
    );
  });

  it("ignores tools a source already materialized", async () => {
    // A local service-account source executes without a Veryfront connection, and a tool exists
    // only because its source listed it, so none of them can be a missing connection.
    const tools = createToolsFromRemoteDefinitions(
      {
        id: "salesforce-service-account",
        listTools: () => Promise.resolve([]),
        executeTool: () => Promise.resolve({}),
      },
      [{
        name: "salesforce__get_case",
        description: "Get a case",
        parameters: { type: "object", properties: {} },
      }],
    );

    assertEquals(
      collectDeclaredIntegrations([
        { agentId: "case-ingest", tools },
        { agentId: "case-dispose", tools: { salesforce__update_case: true } },
      ]),
      [{ integration: "salesforce", agentIds: ["case-dispose"] }],
    );
  });
  it("captures the effective target when project code replaces string trimming", () => {
    const trim = String.prototype.trim;
    let snapshot: ReturnType<typeof snapshotIntegrationDiagnostics>;
    try {
      String.prototype.trim = () => {
        throw new Error("project trim replacement");
      };
      snapshot = snapshotIntegrationDiagnostics({
        fs: { veryfront: { projectSlug: " effective-project " } },
      });
    } finally {
      String.prototype.trim = trim;
    }
    assertEquals(snapshot.executionContext.projectSlug, "effective-project");
  });
  for (const phase of ["before discovery", "during discovery"] as const) {
    it(`preserves connection warnings when trim is replaced ${phase}`, async () => {
      const originalTrim = String.prototype.trim;
      let replacementStack = "";
      const fail = () => {
        const error = new Error("project trim replacement");
        replacementStack ||= error.stack ?? error.message;
        throw error;
      };
      const snapshot = snapshotIntegrationDiagnostics(config);
      const response = new Response('{"tools":[]}', { headers: { "content-length": "12" } });
      const envKey = "VERYFRONT_API_URL";
      const previousUrl = Deno.env.get(envKey);
      let lines: string[] = [];
      try {
        Deno.env.set(envKey, "https://api.test");
        getEnvironmentConfig();
        agentRegistry.register("trim-agent", {
          id: "trim-agent",
          config: { id: "trim-agent", tools: { salesforce__get_case: true } },
          generate: () => Promise.resolve({ text: "" }),
        } as unknown as Agent);
        await withMockFetch(() => {
          if (phase === "during discovery") String.prototype.trim = fail;
          return Promise.resolve(response);
        }, async () => {
          if (phase === "before discovery") String.prototype.trim = fail;
          lines = await findUnconnectedIntegrationLines(snapshot);
        });
      } finally {
        String.prototype.trim = originalTrim;
        agentRegistry.delete("trim-agent");
        if (previousUrl === undefined) Deno.env.delete(envKey);
        else Deno.env.set(envKey, previousUrl);
      }
      assertEquals(lines, [
        "Salesforce isn't connected. Agent trim-agent needs it.",
        "  Connect: npx veryfront integration connect salesforce --project case-demo",
      ], replacementStack);
    });
  }

  it("keeps qualified fallback targets and skips unqualified or proxy diagnostics", async () => {
    const qualified = { authToken: "qualified-token", projectSlug: "linked-project" };
    agentRegistry.register("target-agent", {
      id: "target-agent",
      config: { id: "target-agent", tools: { salesforce__get_case: true } },
      generate: () => Promise.resolve({ text: "" }),
    } as unknown as Agent);
    try {
      assertEquals(snapshotIntegrationDiagnostics(config, qualified).executionContext, qualified);
      assertEquals(
        snapshotIntegrationDiagnostics({ fs: { veryfront: { projectSlug: "  " } } }, qualified)
          .executionContext,
        qualified,
      );
      let requests = 0;
      await withMockFetch(() => {
        requests++;
        return Promise.resolve(Response.json({ tools: [] }));
      }, async () => {
        for (
          const snapshot of [
            snapshotIntegrationDiagnostics(config, {
              authToken: undefined,
              projectSlug: "linked-project",
            }),
            snapshotIntegrationDiagnostics(config, {
              authToken: "qualified-token",
              projectSlug: undefined,
            }),
            snapshotIntegrationDiagnostics({
              fs: { veryfront: { proxyMode: true, projectSlug: "linked-project" } },
            }, qualified),
          ]
        ) assertEquals(await findUnconnectedIntegrationLines(snapshot), []);
      });
      assertEquals(requests, 0);
    } finally {
      agentRegistry.delete("target-agent");
    }
  });
  it("uses the effective project for discovery and advice after preliminary targeting changes", async () => {
    const env = {
      VERYFRONT_API_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "ambient-token",
      VERYFRONT_PROJECT_SLUG: "preliminary-project",
    };
    const previous = new Map(Object.keys(env).map((name) => [name, Deno.env.get(name)]));
    try {
      for (const [name, value] of Object.entries(env)) Deno.env.set(name, value);
      agentRegistry.register("target-agent", {
        id: "target-agent",
        config: { id: "target-agent", tools: { salesforce__get_case: true } },
        generate: () => Promise.resolve({ text: "" }),
      } as unknown as Agent);
      const effective = { ...config, fs: { veryfront: { projectSlug: " effective-project " } } };
      const qualifiedContext = { authToken: "qualified-token", projectSlug: "preliminary-project" };
      const snapshot = snapshotIntegrationDiagnostics(effective, qualifiedContext);
      effective.fs.veryfront.projectSlug = "mutated-project";
      qualifiedContext.projectSlug = "mutated-project";
      qualifiedContext.authToken = "mutated-token";
      const requests: Array<{ project: string | null; authorization: string | null }> = [];
      await withMockFetch((_input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          project: headers.get("x-veryfront-project-slug"),
          authorization: headers.get("authorization"),
        });
        return Promise.resolve(Response.json({ tools: [] }));
      }, async () => {
        assertEquals(await findUnconnectedIntegrationLines(snapshot), [
          "Salesforce isn't connected. Agent target-agent needs it.",
          "  Connect: npx veryfront integration connect salesforce --project effective-project",
        ]);
      });
      assertEquals(requests, [{
        project: "effective-project",
        authorization: "Bearer qualified-token",
      }]);
    } finally {
      agentRegistry.delete("target-agent");
      for (const [name, value] of previous) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  });
  it("warns from custom-root agents and ignores stale default-root sources and disabled discovery", async () => {
    const env = {
      VERYFRONT_API_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "token",
      VERYFRONT_PROJECT_SLUG: "case-demo",
    };
    const previous = new Map(Object.keys(env).map((name) => [name, Deno.env.get(name)]));
    try {
      for (const [name, value] of Object.entries(env)) Deno.env.set(name, value);
      await withTempDir(async (dir) => {
        await Deno.mkdir(`${dir}/crew`);
        await Deno.mkdir(`${dir}/agents`);
        await Deno.writeTextFile(
          `${dir}/crew/crew-agent.ts`,
          `
          export default {
            id: "crew-agent",
            config: { id: "crew-agent", tools: { salesforce__get_case: true, gmail__delete_email: false } },
            generate() { return Promise.resolve({ text: "" }); },
          };
        `,
        );
        await Deno.writeTextFile(
          `${dir}/agents/stale-agent.ts`,
          `
          export default {
            id: "stale-agent",
            config: { id: "stale-agent", tools: { gmail__list_emails: true } },
            generate() { return Promise.resolve({ text: "" }); },
          };
        `,
        );
        const discovery = await discoverAll(createProjectDiscoveryConfig({
          projectDir: dir,
          config,
          allowHostProjectCodeExecution: true,
        }));
        assertEquals(discovery.errors, []);
        assertEquals([...discovery.agents.keys()], ["crew-agent"]);
        await withMockFetch(() => Promise.resolve(Response.json({ tools: [] })), async () => {
          const mutableConfig = {
            ai: { agents: { discovery: { paths: ["crew"] } } },
            integrations: { allow: { salesforce: { allowedTools: ["get_case"] } } },
          };
          const snapshot = snapshotIntegrationDiagnostics(mutableConfig);
          mutableConfig.ai.agents.discovery.paths.length = 0;
          mutableConfig.integrations.allow.salesforce.allowedTools.length = 0;
          assertEquals(Object.isFrozen(snapshot), true);
          assertEquals(await findUnconnectedIntegrationLines(snapshot), [
            "Salesforce isn't connected. Agent crew-agent needs it.",
            "  Connect: npx veryfront integration connect salesforce --project case-demo",
          ]);
          assertEquals(
            await findUnconnectedIntegrationLines(snapshotIntegrationDiagnostics(config)),
            [
              "Salesforce isn't connected. Agent crew-agent needs it.",
              "  Connect: npx veryfront integration connect salesforce --project case-demo",
            ],
          );
          assertEquals(
            await findUnconnectedIntegrationLines(snapshotIntegrationDiagnostics({
              ...config,
              integrations: { allow: { gmail: {} } },
            })),
            [],
          );
          assertEquals(
            await findUnconnectedIntegrationLines(snapshotIntegrationDiagnostics({
              ...config,
              integrations: { allow: { salesforce: { allowedTools: ["update_case"] } } },
            })),
            [],
          );
          // The caller normalizes the policy before agents run; the check uses it as given.
          assertEquals(
            await findUnconnectedIntegrationLines(
              snapshotIntegrationDiagnostics({ ...config, integrations: { allow: { gmail: {} } } }),
            ),
            [],
          );
          // The dev server honors `enabled` only for skills; it still discovers the agent roots.
          assertEquals(
            await findUnconnectedIntegrationLines(snapshotIntegrationDiagnostics({
              ai: { agents: { discovery: { enabled: false, paths: ["crew"] } } },
            })),
            [
              "Salesforce isn't connected. Agent crew-agent needs it.",
              "  Connect: npx veryfront integration connect salesforce --project case-demo",
            ],
          );
          assertEquals(
            await findUnconnectedIntegrationLines(snapshotIntegrationDiagnostics({
              ai: { agents: { discovery: { paths: [] } } },
            })),
            [],
          );
        });
      });
    } finally {
      agentRegistry.delete("crew-agent");
      agentRegistry.delete("stale-agent");
      for (const [name, value] of previous) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  });
});

describe("dev integration diagnostic shutdown", () => {
  for (const phase of ["before discovery", "during transport", "after response"] as const) {
    it(`silences shutdown ${phase} without later requests`, async () => {
      const controller = new AbortController();
      const env = {
        VERYFRONT_API_URL: "https://api.test",
        VERYFRONT_API_TOKEN: "token",
        VERYFRONT_PROJECT_SLUG: "abort-demo",
      };
      const previous = new Map(Object.keys(env).map((name) => [name, Deno.env.get(name)]));
      const output: unknown[] = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => output.push(entry));
      setLogLevel(LogLevel.DEBUG);
      let requests = 0;
      let transportAborted = false;
      try {
        for (const [name, value] of Object.entries(env)) Deno.env.set(name, value);
        agentRegistry.register("abort-agent", {
          id: "abort-agent",
          config: { id: "abort-agent", tools: { salesforce__get_case: true } },
          generate: () => Promise.resolve({ text: "" }),
        } as unknown as Agent);
        // Initialize environment diagnostics before observing the connection check itself.
        getEnvironmentConfig();
        output.length = 0;
        if (phase === "before discovery") controller.abort();
        await withMockFetch((_input, init) => {
          requests++;
          if (phase === "after response") {
            return Promise.resolve(
              new Response(
                new ReadableStream({
                  pull(stream) {
                    stream.enqueue(new TextEncoder().encode('{"tools":[]}'));
                    stream.close();
                    controller.abort();
                    transportAborted = init?.signal?.aborted === true;
                  },
                }),
                { headers: { "content-type": "application/json" } },
              ),
            );
          }
          controller.abort();
          transportAborted = init?.signal?.aborted === true;
          return Promise.reject(new TypeError("transport interrupted"));
        }, async () => {
          assertEquals(
            await findUnconnectedIntegrationLines(
              snapshotIntegrationDiagnostics(config),
              controller.signal,
            ),
            [],
          );
        });
      } finally {
        unsubscribe();
        __resetLoggerConfigForTests();
        agentRegistry.delete("abort-agent");
        for (const [name, value] of previous) {
          if (value === undefined) Deno.env.delete(name);
          else Deno.env.set(name, value);
        }
      }
      assertEquals(transportAborted, phase !== "before discovery");
      assertEquals(requests, phase === "before discovery" ? 0 : 1);
      assertEquals(output, []);
    });
  }
});
