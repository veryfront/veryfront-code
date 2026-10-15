import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  getRuntimeAgentRuntimeOverridesSchema,
  parseRuntimeAgentRunInvocationValue,
  safeParseRuntimeAgentRunInvocationValue,
} from "#veryfront/agent/runtime/agent-invocation-contract.ts";

// These tests install inherited Array.prototype / Object.prototype accessors
// and replace a materialized schema method to prove the deny-all mapping uses
// own data and captured parsers, so they run in integration rather than unit.

const projectId = "10000000-1000-4000-8000-100000000005";
const userId = "10000000-1000-4000-8000-100000000004";

function createDenyAllInvocation(
  providerTools: string[] = ["web_search"],
): Record<string, unknown> {
  return {
    run: {
      agentServiceId: "1-runtime-provider",
      agentId: "builder",
      conversationId: "10000000-1000-4000-8000-100000000001",
      runId: "run_root_1",
      messageId: "10000000-1000-4000-8000-100000000002",
      inputAnchorMessageId: "10000000-1000-4000-8000-100000000003",
      requestedByUserId: userId,
      project: {
        projectId,
        projectSlug: "demo-project",
        runtimeTargetKind: "preview_branch",
        runtimeTargetBranchId: "10000000-1000-4000-8000-100000000006",
      },
      validatedClaims: {
        subject: userId,
        projectId,
        projectSlug: "demo-project",
        scopes: ["agent:run"],
      },
    },
    messages: [],
    agentSource: { type: "branch", branch: "main" },
    agentConfig: {
      id: "builder",
      name: "Builder",
      description: "Runs without host tools.",
      instructions: "Answer directly.",
      tools: false,
      providerTools,
    },
  };
}

it("keeps generated deny-all allowlists intact when an Array.prototype element setter is installed", () => {
  const invocation = createDenyAllInvocation();
  let providerToolWrites = 0;
  Object.defineProperty(Array.prototype, "0", {
    configurable: true,
    get() {
      return undefined;
    },
    set(this: unknown[], value: unknown) {
      // Preserve the first provider-tool snapshot write, then reauthorize the
      // reserved host tool in every later generated allowlist.
      const replaced = value === "web_search" && providerToolWrites++ > 0 ? "invoke_agent" : value;
      Object.defineProperty(this, "0", {
        value: replaced,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    },
  });

  let parsed: ReturnType<typeof parseRuntimeAgentRunInvocationValue>;
  try {
    parsed = parseRuntimeAgentRunInvocationValue(invocation);
  } finally {
    delete (Array.prototype as unknown as Record<string, unknown>)["0"];
  }

  const runtimeOverrides = parsed.forwardedProps?.runtimeOverrides as Record<string, unknown>;
  assertEquals(runtimeOverrides.allowedTools, ["web_search"]);
  assertEquals(runtimeOverrides.toolAllowlist, ["web_search"]);
});

it("does not restore discarded deny-all fields through inherited Object.prototype getters", () => {
  const invocation = createDenyAllInvocation();
  (invocation.agentConfig as Record<string, unknown>).bootstrapSkill = "support-triage";
  Object.defineProperty(Object.prototype, "bootstrapSkill", {
    configurable: true,
    get() {
      return "support-triage";
    },
  });

  let parsed: ReturnType<typeof parseRuntimeAgentRunInvocationValue>;
  try {
    parsed = parseRuntimeAgentRunInvocationValue(invocation);
  } finally {
    delete (Object.prototype as Record<string, unknown>).bootstrapSkill;
  }

  assertEquals(Object.hasOwn(parsed.agentConfig ?? {}, "bootstrapSkill"), false);
});

it("rejects an oversized deny-all allowlist when the live override schema method is replaced", () => {
  const providerTools = Array.from({ length: 101 }, (_, index) => `provider_tool_${index}`);
  const invocation = createDenyAllInvocation(providerTools);
  const schema = getRuntimeAgentRuntimeOverridesSchema() as unknown as Record<string, unknown>;
  const originalSafeParse = schema.safeParse;
  schema.safeParse = (data: unknown) => ({ success: true, data });

  let parsed: ReturnType<typeof safeParseRuntimeAgentRunInvocationValue>;
  try {
    parsed = safeParseRuntimeAgentRunInvocationValue(invocation);
  } finally {
    schema.safeParse = originalSafeParse;
  }

  assertEquals(parsed.success, false);
});
