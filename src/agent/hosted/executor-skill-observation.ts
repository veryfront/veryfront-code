import type { ModelRuntimePromptMessage } from "#veryfront/provider/types.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { isLoadSkillToolName } from "#veryfront/agent/platform-tool-names.ts";
import { extractSkillId } from "#veryfront/agent/runtime/skill-policy-enforcement.ts";

/**
 * Host-side record of which skill bodies the provider has received, built only
 * from load_skill results the host returned and model requests the host brokered.
 */
export interface ExecutorSkillObservation {
  /** Record a host-executed tool result; only successful load_skill bodies count. */
  recordToolResult(toolName: string, toolCallId: string | undefined, result: unknown): void;
  /** Mark bodies observed when a brokered model request carries their results. */
  observePrompt(prompt: readonly ModelRuntimePromptMessage[]): void;
  observedSkillIds(): string[];
}

const hasOwn = Object.hasOwn;

export function createExecutorSkillObservation(): ExecutorSkillObservation {
  const bodies = createPrivateMap<string, string | null>();
  const observed = createPrivateSet<string>();
  return {
    recordToolResult(toolName, toolCallId, result) {
      if (!toolCallId || !isLoadSkillToolName(toolName)) return;
      const skillId = extractSkillId(result) ?? null;
      // A repeated call ID is ambiguous provenance and never becomes observable.
      bodies.set(toolCallId, bodies.has(toolCallId) ? null : skillId);
    },
    observePrompt(prompt) {
      for (let index = 0; index < prompt.length; index++) {
        if (!hasOwn(prompt, index)) continue;
        const message = prompt[index]!;
        if (message.role !== "tool" || !Array.isArray(message.content)) continue;
        for (const part of message.content) {
          if (part?.type !== "tool-result" || typeof part.toolCallId !== "string") continue;
          const skillId = bodies.get(part.toolCallId);
          if (typeof skillId === "string") observed.add(skillId);
        }
      }
    },
    observedSkillIds: () => [...observed],
  };
}
