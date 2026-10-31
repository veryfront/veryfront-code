import { inheritTrustedPlatformSource } from "#veryfront/tool/platform-source-provenance.ts";
import { createMcpToolPolicyGate } from "./mcp-tool-policy.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createLivePlatformMcpSource,
  createPlatformMcpCatalogSource,
  platformMcpLegacyName,
  withPlatformMcpPolicyAliases,
} from "./platform-mcp-tool-source.ts";

describe("platform MCP catalog aliases", () => {
  it("does not turn integration names into platform aliases", async () => {
    const calls: string[] = [];
    const source = createLivePlatformMcpSource({
      id: "platform",
      listTools: async () =>
        ["get_file", "github__delete_repo"].map((name) => ({
          name,
          description: name,
          parameters: { type: "object" as const, properties: {} },
        })),
      executeTool: async (name) => {
        calls.push(name);
        return {};
      },
    });
    assertEquals((await source.listTools()).map(({ name }) => name), [
      "veryfront__get_file",
      "github__delete_repo",
    ]);
    assertEquals(
      platformMcpLegacyName("veryfront__github__delete_repo"),
      "veryfront__github__delete_repo",
    );
    assertEquals(platformMcpLegacyName("veryfront__"), "veryfront__");
    await source.executeTool("veryfront__get_file", {});
    await source.executeTool("github__delete_repo", {});
    assertEquals(calls, ["get_file", "github__delete_repo"]);
  });

  it("preserves existing canonical definitions without overwriting their dispatch", async () => {
    const calls: string[] = [];
    const definitions = ["get_file", "veryfront__get_file"].map((name) => ({
      name,
      description: name,
      parameters: { type: "object" as const, properties: {} },
    }));
    const catalog = createPlatformMcpCatalogSource({
      id: "platform",
      listTools: async () => definitions,
      executeTool: async (name) => {
        calls.push(name);
        return {};
      },
    }, definitions);
    const canonicalDefinition = definitions[1];
    assertExists(canonicalDefinition);
    assertEquals(catalog.definitions, [canonicalDefinition]);
    await catalog.source.executeTool("veryfront__get_file", {});
    assertEquals(calls, ["veryfront__get_file"]);
  });
});

it("platform policy aliases observe subsequent policy revocation", () => {
  const policy: { allow?: string[]; deny?: string[] } = { allow: ["veryfront__get_file"] };
  const legacyGate = createMcpToolPolicyGate(withPlatformMcpPolicyAliases(policy));
  const aliasGate = createMcpToolPolicyGate(
    withPlatformMcpPolicyAliases(policy),
  );
  assertEquals(legacyGate.allows("get_file"), true);
  assertEquals(aliasGate.allows("get_file"), true);
  policy.deny = ["veryfront__get_file"];
  assertThrows(() => legacyGate.assertAllowed("get_file"));
  assertThrows(() => aliasGate.assertAllowed("get_file"));
  assertThrows(() => aliasGate.assertAllowed("veryfront__get_file"));
});

it("live platform catalogs preserve existing canonical dispatch", async () => {
  const calls: string[] = [];
  const source = createLivePlatformMcpSource({
    id: "platform",
    listTools: async () => [{
      name: "veryfront__get_file",
      description: "Read",
      parameters: { type: "object" as const, properties: {} },
    }],
    executeTool: async (name) => {
      calls.push(name);
      return {};
    },
  });
  assertEquals((await source.listTools()).map(({ name }) => name), [
    "veryfront__get_file",
  ]);
  await source.executeTool("veryfront__get_file", {});
  await assertRejects(() => source.executeTool("get_file", {}));
  assertEquals(calls, ["veryfront__get_file"]);
});

it("live platform execution resolves undiscovered aliases without repeating known discovery", async () => {
  let listings = 0;
  const calls: string[] = [];
  const names = ["get_file"];
  const source = createLivePlatformMcpSource({
    id: "platform",
    listTools: async () => {
      listings++;
      return names.map((name) => ({
        name,
        description: name,
        parameters: { type: "object" as const, properties: {} },
      }));
    },
    executeTool: async (name) => {
      calls.push(name);
      return {};
    },
  });
  await source.executeTool("veryfront__get_file", {});
  assertEquals(calls, ["get_file"]);
  assertEquals(listings, 1);
  await source.executeTool("veryfront__get_file", {});
  assertEquals(listings, 1);
  names.push("update_file");
  await source.executeTool("veryfront__update_file", {});
  assertEquals(calls, ["get_file", "get_file", "update_file"]);
  assertEquals(listings, 2);
});

it("live platform execution rejects every unadvertised qualified name after one refresh", async () => {
  let listings = 0;
  const calls: string[] = [];
  const source = createLivePlatformMcpSource({
    id: "platform",
    listTools: async () => {
      listings++;
      return [{
        name: "get_file",
        description: "Read",
        parameters: { type: "object" as const, properties: {} },
      }];
    },
    executeTool: async (name) => {
      calls.push(name);
      return {};
    },
  });

  await assertRejects(
    () => source.executeTool("veryfront__hidden_admin_operation", {}),
    Error,
    "not in the platform catalog",
  );
  await assertRejects(
    () => source.executeTool("github__unknown", {}),
    Error,
    "not in the platform catalog",
  );
  await assertRejects(
    () => source.executeTool("get_file", {}),
    Error,
    "not in the platform catalog",
  );

  assertEquals(listings, 3, "each absent name refreshes the live catalog exactly once");
  assertEquals(calls, [], "unadvertised names must never reach the underlying source");
});

it("live platform execution discovers a newly advertised connector before dispatch", async () => {
  let listings = 0;
  const calls: string[] = [];
  const names = ["get_file"];
  const source = createLivePlatformMcpSource({
    id: "platform",
    listTools: async () => {
      listings++;
      return names.map((name) => ({
        name,
        description: name,
        parameters: { type: "object" as const, properties: {} },
      }));
    },
    executeTool: async (name) => {
      calls.push(name);
      return {};
    },
  });

  await source.listTools();
  names.push("github__list_issues");
  await source.executeTool("github__list_issues", {});

  assertEquals(listings, 2);
  assertEquals(calls, ["github__list_issues"]);
});

it("does not restore aliases removed by an outer policy when adapted again", async () => {
  const calls: string[] = [];
  const adapted = createLivePlatformMcpSource({
    id: "platform",
    listTools: async () => [{
      name: "veryfront__get_file",
      description: "Read",
      parameters: { type: "object" as const, properties: {} },
    }],
    executeTool: async (name) => {
      calls.push(name);
      return {};
    },
  });
  const filtered = inheritTrustedPlatformSource(adapted, {
    id: adapted.id,
    listTools: async () =>
      (await adapted.listTools()).filter(({ name }) => name === "veryfront__get_file"),
    executeTool: (name: string, args: Record<string, unknown>) => {
      if (name !== "veryfront__get_file") throw new Error("Denied");
      return adapted.executeTool(name, args);
    },
  });
  const runtime = createLivePlatformMcpSource(filtered);
  assertEquals(runtime, filtered);
  assertEquals((await runtime.listTools()).map(({ name }) => name), ["veryfront__get_file"]);
  assertThrows(() => runtime.executeTool("get_file", {}));
  await runtime.executeTool("veryfront__get_file", {});
  assertEquals(calls, ["veryfront__get_file"]);
});

describe("current-run platform lookup", () => {
  const runId = "bf486556-ec8a-446d-9184-7a9890966a1d";
  const definitions = ["get_run", "get_file"].map((name) => ({
    name,
    description: name,
    parameters: {
      type: "object" as const,
      properties: { run_id: { type: "string" as const } },
      required: ["run_id"],
    },
  }));
  function fixture(binding?: { runId?: string; runIdBindsToolAuthorization?: boolean }) {
    const calls: unknown[] = [];
    const catalog = createPlatformMcpCatalogSource(
      {
        id: "platform",
        listTools: async () => definitions,
        executeTool: async (_name, args) => {
          calls.push(args);
          return args;
        },
      },
      definitions,
      binding,
    );
    return { ...catalog, calls };
  }
  it("projects only get_run and dispatches the authoritative ID when omitted", async () => {
    const bound = fixture({ runId, runIdBindsToolAuthorization: true });
    assertEquals(bound.definitions[0]?.parameters.required, []);
    assertEquals(bound.definitions[1]?.parameters.required, ["run_id"]);
    assertEquals(definitions[0]?.parameters.required, ["run_id"]);
    await bound.source.executeTool("veryfront__get_run", {});
    assertEquals(bound.calls, [{ run_id: runId }]);
  });
  it("preserves every explicit run_id for API validation and authorization", async () => {
    const bound = fixture({ runId, runIdBindsToolAuthorization: true });
    for (const value of ["10000000-1000-4000-8000-100000000001", "invalid", null, undefined]) {
      const args = { run_id: value };
      await bound.source.executeTool("veryfront__get_run", args);
      assertEquals(bound.calls.at(-1), args);
    }
    await bound.source.executeTool("veryfront__get_file", {});
    assertEquals(bound.calls.at(-1), {});
  });
  it("requires explicit IDs without valid binding authority", async () => {
    for (
      const binding of [undefined, {}, { runId }, {
        runId: "invalid",
        runIdBindsToolAuthorization: true,
      }, {
        runId,
        runIdBindsToolAuthorization: false,
      }]
    ) {
      const unbound = fixture(binding);
      assertEquals(unbound.definitions[0]?.parameters.required, ["run_id"]);
      await unbound.source.executeTool("veryfront__get_run", {});
      assertEquals(unbound.calls, [{}]);
    }
  });
});

it("live current-run binding follows each execution context without retaining another run", async () => {
  const calls: unknown[] = [];
  const source = createLivePlatformMcpSource({
    id: "platform",
    listTools: async () => [{
      name: "get_run",
      description: "Read run",
      parameters: {
        type: "object",
        properties: { run_id: { type: "string" } },
        required: ["run_id"],
      },
    }],
    executeTool: async (_name, args) => {
      calls.push(args);
      return args;
    },
  });
  const first = "bf486556-ec8a-446d-9184-7a9890966a1d";
  const second = "10000000-1000-4000-8000-100000000001";
  assertEquals(
    (await source.listTools({ runId: first, runIdBindsToolAuthorization: true }))[0]?.parameters
      .required,
    [],
  );
  await source.executeTool("veryfront__get_run", {}, {
    runId: first,
    runIdBindsToolAuthorization: true,
  });
  await source.executeTool("veryfront__get_run", {}, {
    runId: second,
    runIdBindsToolAuthorization: true,
  });
  await source.executeTool("veryfront__get_run", {}, {
    runId: second,
    runIdBindsToolAuthorization: false,
  });
  assertEquals((await source.listTools())[0]?.parameters.required, ["run_id"]);
  assertEquals(calls, [{ run_id: first }, { run_id: second }, {}]);
});

it("a verified run-scoped live source binds discovery and dispatch without caller context", async () => {
  const runId = "bf486556-ec8a-446d-9184-7a9890966a1d";
  const calls: unknown[] = [];
  const source = createLivePlatformMcpSource({
    id: "platform",
    listTools: async () => [{
      name: "get_run",
      description: "Read run",
      parameters: {
        type: "object",
        properties: { run_id: { type: "string" } },
        required: ["run_id"],
      },
    }],
    executeTool: async (_name, args) => {
      calls.push(args);
      return args;
    },
  }, { runId, runIdBindsToolAuthorization: true });
  assertEquals((await source.listTools())[0]?.parameters.required, []);
  await source.executeTool("veryfront__get_run", {});
  await source.executeTool("veryfront__get_run", {}, {
    runId: "10000000-1000-4000-8000-100000000001",
  });
  assertEquals(calls, [{ run_id: runId }, { run_id: runId }]);
});

it("agent management errors stay on items through platform tool aliases", async () => {
  const payload: import("./identity-contracts.ts").AgentManagementList = {
    data: [{
      id: "source_abc",
      name: "broken",
      description: null,
      model: null,
      avatar_url: null,
      source_type: "project",
      source_path: "agents/broken.ts",
      edit_mode: "source_only",
      can_run: false,
      errors: [{ code: "parse_error", message: "Missing initializer", line: 3, column: 11 }],
    }],
  };
  const calls: unknown[] = [];
  const source = createLivePlatformMcpSource({
    id: "api",
    listTools: async () => [{
      name: "list_agents",
      description: "List agents",
      parameters: { type: "object", properties: {} },
    }],
    executeTool: async (name, args) => {
      calls.push({ name, args });
      return { content: [], structuredContent: payload };
    },
  });
  const result = await source.executeTool("veryfront__list_agents", { project_reference: "demo" });
  assertEquals(result, { content: [], structuredContent: payload });
  assertEquals(calls, [{ name: "list_agents", args: { project_reference: "demo" } }]);
});
