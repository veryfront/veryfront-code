import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import type { AgentMcpToolPolicy } from "./types.ts";
import {
  createMcpToolPolicyGate,
  wrapHostToolSetWithMcpPolicy,
  wrapRemoteToolSourceWithMcpPolicy,
} from "./mcp-tool-policy.ts";
import type { HostToolSet, RemoteToolSource, ToolDefinition } from "#veryfront/tool";

const emptyParameters = { type: "object" as const, properties: {} };

function remoteTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: emptyParameters,
  };
}

function remoteSource(tools: ToolDefinition[], calls: string[] = []): RemoteToolSource {
  return {
    id: "docs",
    listTools: () => Promise.resolve(tools),
    executeTool: (toolName, args, context) => {
      calls.push(`${toolName}:${String(args.value)}:${String(context?.projectId)}`);
      return Promise.resolve({ ok: true, toolName });
    },
  };
}

function hostToolSet(calls: string[] = []): HostToolSet {
  return {
    search_docs: {
      description: "Search docs",
      execute: (input) => {
        calls.push(`search_docs:${String((input as Record<string, unknown>).value)}`);
        return { ok: true, toolName: "search_docs" };
      },
    },
    delete_docs: {
      description: "Delete docs",
      execute: (input) => {
        calls.push(`delete_docs:${String((input as Record<string, unknown>).value)}`);
        return { ok: true, toolName: "delete_docs" };
      },
    },
    hidden_without_execute: {
      description: "Metadata only",
    },
  };
}

function assertPermissionDenied(error: unknown, detail: string) {
  if (!(error instanceof VeryfrontError)) {
    throw new Error("Expected VeryfrontError");
  }

  assertEquals(error.slug, "permission-denied");
  assertEquals(error.message, detail);
  assertEquals(error.detail, detail);
}

function captureThrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error("Expected function to throw");
}

describe("agent/mcp-tool-policy", () => {
  it("createMcpToolPolicyGate(undefined) allows all names", () => {
    const gate = createMcpToolPolicyGate(undefined);

    assertEquals(gate.allows("search_docs"), true);
    assertEquals(gate.allows("delete_docs"), true);
    assertEquals(gate.filterDefinitions([remoteTool("search_docs"), remoteTool("delete_docs")]), [
      remoteTool("search_docs"),
      remoteTool("delete_docs"),
    ]);
    gate.assertAllowed("delete_docs");
  });

  it("deny wins over allow", () => {
    const gate = createMcpToolPolicyGate({
      allow: ["search_docs", "delete_docs"],
      deny: ["delete_docs"],
    });

    assertEquals(gate.allows("search_docs"), true);
    assertEquals(gate.allows("delete_docs"), false);
    assertEquals(gate.filterDefinitions([remoteTool("search_docs"), remoteTool("delete_docs")]), [
      remoteTool("search_docs"),
    ]);
  });

  it("allow filters definition order without sorting", () => {
    const gate = createMcpToolPolicyGate({
      allow: ["beta", "alpha"],
    });

    assertEquals(
      gate.filterDefinitions([remoteTool("gamma"), remoteTool("alpha"), remoteTool("beta")]).map((
        tool,
      ) => tool.name),
      ["alpha", "beta"],
    );
  });

  it('approval: "never" does not affect allow and deny behavior', () => {
    const gate = createMcpToolPolicyGate({
      allow: ["search_docs"],
      deny: ["delete_docs"],
      approval: "never",
    });

    assertEquals(gate.allows("search_docs"), true);
    assertEquals(gate.allows("delete_docs"), false);
    assertEquals(gate.allows("list_docs"), false);
  });

  it("reads policy mutations after gate creation", () => {
    const policy: AgentMcpToolPolicy = { allow: ["search_docs"], deny: ["delete_docs"] };
    const gate = createMcpToolPolicyGate(policy, {
      deniedDetail: (toolName) => `Denied ${toolName}`,
    });

    assertEquals(gate.allows("search_docs"), true);
    assertEquals(gate.allows("write_docs"), false);

    policy.allow?.push("write_docs");
    policy.deny = ["search_docs"];

    assertEquals(gate.allows("search_docs"), false);
    assertEquals(gate.allows("write_docs"), true);
    assertEquals(
      gate.filterDefinitions([remoteTool("search_docs"), remoteTool("write_docs")]).map((tool) =>
        tool.name
      ),
      ["write_docs"],
    );

    const error = captureThrown(() => gate.assertAllowed("search_docs"));
    assertPermissionDenied(error, "Denied search_docs");
  });

  it("wrapRemoteToolSourceWithMcpPolicy returns the same source for empty policy", () => {
    const source = remoteSource([remoteTool("search_docs")]);

    assertStrictEquals(wrapRemoteToolSourceWithMcpPolicy(source, undefined), source);
    assertStrictEquals(wrapRemoteToolSourceWithMcpPolicy(source, {}), source);
    assertStrictEquals(wrapRemoteToolSourceWithMcpPolicy(source, { approval: "never" }), source);
  });

  it("wrapped remote listTools filters dynamically", async () => {
    const policy: AgentMcpToolPolicy = { allow: ["search_docs"] };
    const source = remoteSource([remoteTool("search_docs"), remoteTool("delete_docs")]);
    const wrapped = wrapRemoteToolSourceWithMcpPolicy(source, policy);

    assertStrictEquals(wrapped.id, source.id);
    assertEquals((await wrapped.listTools()).map((tool) => tool.name), ["search_docs"]);

    policy.allow = ["delete_docs"];

    assertEquals((await wrapped.listTools()).map((tool) => tool.name), ["delete_docs"]);
  });

  it("wrapped remote executeTool blocks denied names before calling the source", async () => {
    const calls: string[] = [];
    const source = remoteSource([remoteTool("search_docs"), remoteTool("delete_docs")], calls);
    const wrapped = wrapRemoteToolSourceWithMcpPolicy(source, { deny: ["delete_docs"] }, {
      deniedDetail: (toolName, sourceId) => `Tool ${toolName} denied for ${sourceId}`,
    });
    const detail = "Tool delete_docs denied for docs";

    assertStrictEquals(wrapped.id, source.id);
    const error = captureThrown(() =>
      wrapped.executeTool("delete_docs", { value: "blocked" }, { projectId: "project-1" })
    );
    assertPermissionDenied(error, detail);
    assertEquals(calls, []);

    assertEquals(
      await wrapped.executeTool("search_docs", { value: "allowed" }, { projectId: "project-1" }),
      {
        ok: true,
        toolName: "search_docs",
      },
    );
    assertEquals(calls, ["search_docs:allowed:project-1"]);
  });

  it("wrapHostToolSetWithMcpPolicy filters visible Tools and blocks execution after policy mutation", async () => {
    const calls: string[] = [];
    const policy: AgentMcpToolPolicy = { allow: ["search_docs", "hidden_without_execute"] };
    const wrapped = wrapHostToolSetWithMcpPolicy(hostToolSet(calls), policy, {
      deniedDetail: (toolName) => `Host tool ${toolName} denied`,
    });

    assertEquals(Object.keys(wrapped), ["search_docs", "hidden_without_execute"]);
    assertEquals(await wrapped.search_docs?.execute?.({ value: "first" }), {
      ok: true,
      toolName: "search_docs",
    });

    policy.deny = ["search_docs"];

    const error = captureThrown(() => wrapped.search_docs!.execute!({ value: "second" }));
    assertPermissionDenied(error, "Host tool search_docs denied");
    assertEquals(calls, ["search_docs:first"]);
  });

  it("detail builder preserves exact caller-provided denial text", () => {
    const detail = 'Tool "delete_docs" is not allowed for MCP server "docs"';
    const gate = createMcpToolPolicyGate({ deny: ["delete_docs"] }, {
      deniedDetail: () => detail,
    });

    const error = captureThrown(() => gate.assertAllowed("delete_docs"));

    assertPermissionDenied(error, detail);
  });
});
