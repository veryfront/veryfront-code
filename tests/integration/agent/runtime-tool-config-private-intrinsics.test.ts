import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import { getRuntimeProviderReplayInvokeAgentToolNames } from "#veryfront/agent/runtime/runtime-tool-config.ts";

function runtimeConfig(extra: Record<string, unknown> = {}): AgentConfig {
  return {
    model: "auto",
    system: "Test runtime tool config.",
    ...extra,
  } as AgentConfig;
}

it("copies delegation authorization without mutable array push", () => {
  const config = runtimeConfig({
    __vfProviderReplayInvokeAgentToolNames: ["veryfront__invoke_agent"],
  });
  const originalPush = Array.prototype.push;
  let names: unknown;
  Array.prototype.push = function (...items) {
    if (items[0] === "veryfront__invoke_agent") originalPush.call(this, "invoke_agent");
    return originalPush.apply(this, items);
  };
  try {
    names = getRuntimeProviderReplayInvokeAgentToolNames(config);
  } finally {
    Array.prototype.push = originalPush;
  }
  assertEquals(names, ["veryfront__invoke_agent"]);
});
