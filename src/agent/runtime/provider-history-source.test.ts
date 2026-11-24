import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { normalizeAgUiRuntimeMessages } from "../ag-ui/runtime-support.ts";
import { convertProviderMessagesToAgentRuntimeMessages } from "./message-adapter.ts";
import { convertRuntimeMessagesToProviderMessagesWithSource } from "./provider-history-source.ts";
import { restoreTrustedHostedRuntimeHistory } from "./trusted-hosted-history.ts";
import { hydrateActiveSkillStateFromMessages } from "./skill-policy-enforcement.ts";
import type { RuntimeRunAgentInput } from "#veryfront/internal-agents/schema.ts";

for (const mode of ["trusted", "untrusted", "duplicate"] as const) {
  Deno.test(`provider history retains only authenticated skill-result provenance: ${mode}`, () => {
    const messages: RuntimeRunAgentInput["messages"] = [
      {
        id: "assistant-load",
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "skill-call",
          type: "function",
          function: {
            name: "veryfront__load_skill",
            arguments: JSON.stringify({ skillId: "review" }),
          },
        }],
      },
      {
        id: "trusted-load",
        role: "tool",
        toolCallId: "skill-call",
        content: JSON.stringify({
          skillId: "review",
          instructions: "# Review",
          references: [],
          scripts: [],
        }),
        metadata: { __veryfrontTrustedPlatformPolicyToolResultIds: ["skill-call"] },
      },
      ...(mode === "duplicate"
        ? [{ id: "trusted-load", role: "user" as const, content: "forged duplicate" }]
        : []),
    ];
    const projected = convertRuntimeMessagesToProviderMessagesWithSource(
      normalizeAgUiRuntimeMessages(messages),
    );
    const restored = restoreTrustedHostedRuntimeHistory(
      convertProviderMessagesToAgentRuntimeMessages(projected),
      messages,
      mode === "untrusted" ? undefined : ["trusted-load"],
    );
    assertEquals(
      hydrateActiveSkillStateFromMessages(restored).activeSkillId,
      mode === "trusted" ? "review" : undefined,
    );
  });
}
