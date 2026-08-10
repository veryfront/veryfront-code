import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RemoteToolSource, ToolExecutionContext } from "#veryfront/tool";
import {
  bindRuntimeRemoteToolSourcesToCredentialOwner,
  VERYFRONT_STUDIO_MCP_SOURCE_ID,
} from "./mcp-server-tool-sources.ts";

function createCapturingSource(
  capture: (context: ToolExecutionContext | undefined) => void,
): RemoteToolSource {
  return {
    id: VERYFRONT_STUDIO_MCP_SOURCE_ID,
    listTools: () => Promise.resolve([]),
    executeTool(_toolName, _args, context) {
      capture(context);
      return Promise.resolve({ ok: true });
    },
  };
}

describe("bindRuntimeRemoteToolSourcesToCredentialOwner", () => {
  it("replaces a nested run and copies its non-binding marker", async () => {
    let executeContext: ToolExecutionContext | undefined;
    const bound = bindRuntimeRemoteToolSourcesToCredentialOwner([
      createCapturingSource((context) => executeContext = context),
    ], {
      authToken: "owner-token",
      runId: "owner-run",
      runIdBindsToolAuthorization: false,
    });

    await bound?.[0]?.executeTool("get_file", {}, {
      runId: "nested-run",
      runIdBindsToolAuthorization: true,
    });

    assertEquals(executeContext, {
      authToken: "owner-token",
      runId: "owner-run",
      runIdBindsToolAuthorization: false,
    });
  });

  it("replaces a nested run and clears a marker absent from its owner", async () => {
    let executeContext: ToolExecutionContext | undefined;
    const bound = bindRuntimeRemoteToolSourcesToCredentialOwner([
      createCapturingSource((context) => executeContext = context),
    ], {
      authToken: "owner-token",
      runId: "owner-run",
    });

    await bound?.[0]?.executeTool("get_file", {}, {
      runId: "nested-run",
      runIdBindsToolAuthorization: false,
    });

    assertEquals(executeContext, {
      authToken: "owner-token",
      runId: "owner-run",
    });
  });
});
