import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  canonicalizeFrameworkModulePath,
  isPrivateFrameworkModulePath,
} from "./private-framework-module-policy.ts";

Deno.test("private framework module policy canonicalizes bypass spellings", () => {
  for (
    const path of [
      "#veryfront/agent/hosted/internal/control-plane-mcp-source.ts",
      "#veryfront/agent/hosted/x/../internal/control-plane-mcp-source.ts",
      "#veryfront/agent/hosted/%2e%2e/hosted/internal/control-plane-mcp-source.ts",
      "#veryfront/agent/hosted%2Finternal%2Fcontrol-plane-mcp-source.ts",
      "_veryfront//agent/hosted/internal/control-plane-mcp-source",
      "_veryfront/agent\\hosted\\internal\\control-plane-mcp-source",
      "_veryfront/agent/hosted/Internal/control-plane-mcp-source",
      "_veryfront/agent/hosted/internal./control-plane-mcp-source",
      "_veryfront/agent/hosted/internal%20/control-plane-mcp-source",
      "_veryfront/agent/hosted/x/..%20/internal/control-plane-mcp-source",
      "_veryfront/agent/hosted/.%20/internal/control-plane-mcp-source",
      "/_vf_modules/_veryfront/agent/hosted/internal/control-plane-mcp-source.js",
    ]
  ) {
    assertEquals(isPrivateFrameworkModulePath(path), true, path);
  }

  assertEquals(
    canonicalizeFrameworkModulePath("#veryfront/agent/hosted/x/../internal/tool.ts"),
    "agent/hosted/internal/tool.ts",
  );
  assertEquals(
    isPrivateFrameworkModulePath("#veryfront/agent/hosted/default-chat-runtime.ts"),
    false,
  );
});
