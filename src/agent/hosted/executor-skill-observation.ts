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

import { type BoundedJsonValue, snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { readToolResultOwnDataProperty as readOwn } from "#veryfront/tool/result.ts";

const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const keys = Object.keys;

function equalBody(left: BoundedJsonValue, right: BoundedJsonValue): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  if (isArray(left)) {
    if (!isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (!equalBody(left[index]!, right[index]!)) return false;
    }
    return true;
  }
  if (isArray(right)) return false;
  const names = keys(left);
  if (names.length !== keys(right).length) return false;
  for (let index = 0; index < names.length; index++) {
    const name = names[index]!;
    if (!hasOwn(right, name) || !equalBody(left[name]!, right[name]!)) return false;
  }
  return true;
}

export function createExecutorSkillObservation(): ExecutorSkillObservation {
  const bodies = createPrivateMap<string, { skillId: string; value: BoundedJsonValue } | null>();
  const observed = createPrivateSet<string>();
  return {
    recordToolResult(toolName, toolCallId, result) {
      if (!toolCallId || !isLoadSkillToolName(toolName)) return;
      const skillId = extractSkillId(result);
      const snapshot = snapshotBoundedJsonValue(result);
      // A repeated call ID is ambiguous provenance and never becomes observable.
      bodies.set(
        toolCallId,
        bodies.has(toolCallId) || !skillId || !snapshot.success
          ? null
          : { skillId, value: snapshot.value },
      );
    },
    observePrompt(prompt) {
      for (let index = 0; index < prompt.length; index++) {
        if (!hasOwn(prompt, index)) continue;
        const message = prompt[index]!;
        const content = readOwn(message, "content");
        if (readOwn(message, "role") !== "tool" || !isArray(content)) continue;
        for (let partIndex = 0; partIndex < content.length; partIndex++) {
          if (!hasOwn(content, partIndex)) continue;
          const part = content[partIndex];
          const toolCallId = readOwn(part, "toolCallId");
          const toolName = readOwn(part, "toolName");
          if (
            readOwn(part, "type") !== "tool-result" || typeof toolCallId !== "string" ||
            typeof toolName !== "string" || !isLoadSkillToolName(toolName)
          ) continue;
          const body = bodies.get(toolCallId);
          const output = readOwn(part, "output");
          if (!body || readOwn(output, "type") !== "json") continue;
          const snapshot = snapshotBoundedJsonValue(readOwn(output, "value"));
          if (snapshot.success && equalBody(body.value, snapshot.value)) observed.add(body.skillId);
        }
      }
    },
    observedSkillIds: () => [...observed],
  };
}
