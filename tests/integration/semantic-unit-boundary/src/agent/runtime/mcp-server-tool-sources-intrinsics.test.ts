/**
 * Veryfront API MCP bootstrap under poisoned intrinsics.
 *
 * The runtime bootstrap carries the host-owned API token and the endpoint it
 * is sent to, and an agent runs project-authored code in the same process.
 * These cases replace `String.prototype.trim` and `String.prototype.replace`,
 * a process-global effect, so they live in the semantic integration suite
 * rather than beside the unit tests.
 */
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RemoteMCPToolSourceConfig, RemoteToolSource } from "#veryfront/tool";
import {
  getRuntimeRemoteToolSources,
  getRuntimeUnavailableOptionalRemoteTools,
  VERYFRONT_STUDIO_MCP_SOURCE_ID,
} from "../../../../../../src/agent/runtime/mcp-server-tool-sources.ts";

async function resolveRemoteEndpoint(
  endpoint: RemoteMCPToolSourceConfig["endpoint"] | undefined,
): Promise<string | undefined> {
  if (endpoint === undefined) return undefined;
  return typeof endpoint === "function" ? await endpoint() : endpoint;
}

describe("Veryfront API MCP bootstrap intrinsic boundary", () => {
  it("does not expose host auth to replaced trim", () => {
    const originalTrim = String.prototype.trim;
    const observed: string[] = [];
    String.prototype.trim = function () {
      observed.push(String(this));
      return Reflect.apply(originalTrim, this, []);
    };
    try {
      const sources = getRuntimeRemoteToolSources(
        {
          system: "Use project files.",
          tools: { get_file: true },
          mcpServers: [{ kind: "veryfront-api" }],
        },
        {
          getVeryfrontBootstrap: () => ({
            apiBaseUrl: "https://api.example/",
            apiToken: "server-token",
            projectSlug: "server-project",
            hasRequestContext: false,
            usesVeryfrontFs: false,
          }),
          createRemoteToolSource: () => ({
            id: "veryfront-api",
            listTools: () => Promise.resolve([]),
            executeTool: () => Promise.resolve(undefined),
          }),
        },
      );
      assertEquals(sources?.length, 1);
    } finally {
      String.prototype.trim = originalTrim;
    }
    assertEquals(observed.includes("server-token"), false);
  });

  it("does not expose injected Studio source arrays to replaced Array map", () => {
    const studioSource: RemoteToolSource = {
      id: VERYFRONT_STUDIO_MCP_SOURCE_ID,
      listTools: () => Promise.resolve([]),
      executeTool: () => Promise.resolve({ ok: true }),
    };
    const originalMap = Array.prototype.map;
    let patchedMapCalls = 0;
    let result: { names: string[]; prefixes: string[] } | undefined;
    Array.prototype.map = function poisonedMap() {
      patchedMapCalls += 1;
      throw new Error("patched Array.prototype.map must not see remote sources");
    } as typeof Array.prototype.map;
    try {
      result = getRuntimeUnavailableOptionalRemoteTools(
        {
          system: "Use Studio tools when available.",
          tools: { studio_open_project: true },
          mcpServers: [{ kind: "veryfront-studio", required: false }],
        },
        [studioSource],
      );
    } finally {
      Array.prototype.map = originalMap;
    }

    assertEquals(patchedMapCalls, 0);
    assertEquals(result, { names: [], prefixes: [] });
  });

  it("deduplicates unavailable Studio tools without replaced Array includes", () => {
    const originalIncludes = Array.prototype.includes;
    let patchedIncludesCalls = 0;
    let result: { names: string[]; prefixes: string[] } | undefined;
    Array.prototype.includes = function poisonedIncludes() {
      patchedIncludesCalls += 1;
      throw new Error("patched Array.prototype.includes must not dedupe unavailable tools");
    } as typeof Array.prototype.includes;
    try {
      result = getRuntimeUnavailableOptionalRemoteTools(
        {
          system: "Use Studio tools when available.",
          tools: { studio_open_project: true },
          __vfUnavailableOptionalRemoteToolPrefixes: ["studio_"],
          mcpServers: [{ kind: "veryfront-studio", required: false }],
        },
        [],
      );
    } finally {
      Array.prototype.includes = originalIncludes;
    }

    assertEquals(patchedIncludesCalls, 0);
    assertEquals(result, { names: [], prefixes: ["studio_"] });
  });

  it("ignores a replaced string replace method when resolving its endpoint", async () => {
    const originalReplace = String.prototype.replace;
    let remoteConfig: RemoteMCPToolSourceConfig | undefined;
    String.prototype.replace = function () {
      return "https://project-controlled.example";
    };
    try {
      getRuntimeRemoteToolSources(
        {
          system: "Use project files.",
          tools: { get_file: true },
          mcpServers: [{ kind: "veryfront-api" }],
        },
        {
          getVeryfrontBootstrap: () => ({
            apiBaseUrl: "https://api.example/",
            apiToken: "server-token",
            projectSlug: "server-project",
            hasRequestContext: false,
            usesVeryfrontFs: false,
          }),
          createRemoteToolSource: (config) => {
            remoteConfig = config;
            return {
              id: "veryfront-api",
              listTools: () => Promise.resolve([]),
              executeTool: () => Promise.resolve(undefined),
            };
          },
        },
      );
    } finally {
      String.prototype.replace = originalReplace;
    }

    assertEquals(
      await resolveRemoteEndpoint(remoteConfig?.endpoint),
      "https://api.example/projects/server-project/mcp",
    );
  });
});
