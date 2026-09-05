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
import type { RemoteMCPToolSourceConfig } from "#veryfront/tool";
import { getRuntimeRemoteToolSources } from "../../../../../../src/agent/runtime/mcp-server-tool-sources.ts";

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
