import type { ModelRuntimePromptMessage } from "#veryfront/provider/types.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { isLoadSkillToolName } from "#veryfront/agent/platform-tool-names.ts";
import {
  extractSkillId,
  extractSkillToolAvailability,
} from "#veryfront/agent/runtime/skill-policy-enforcement.ts";
import type { ProviderObservedSkillBody } from "#veryfront/agent/runtime/provider-observed-skill-bodies.ts";

/**
 * Host-side record of which skill bodies the provider has received, built only
 * from load_skill results the host returned and model requests the host brokered.
 */
export interface ExecutorSkillObservation {
  /** Record a host-executed tool result; only successful load_skill bodies count. */
  recordToolResult(toolName: string, toolCallId: string | undefined, result: unknown): void;
  /** Mark bodies observed when a brokered model request carries their exact results. */
  observePrompt(prompt: readonly ModelRuntimePromptMessage[]): void;
  observedSkillBodies(): ProviderObservedSkillBody[];
}

type RecordedBody = Readonly<{
  toolName: string;
  content: string;
  body: ProviderObservedSkillBody;
}>;

const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const objectKeys = Object.keys;
const stringify = JSON.stringify;
const MAX_CANONICAL_DEPTH = 64;

/** Key-sorted JSON so the host and the prompt compare the same value, not its spelling. */
function canonicalJson(value: unknown, depth = 0): string | undefined {
  if (depth > MAX_CANONICAL_DEPTH) return undefined;
  if (value === null || typeof value !== "object") {
    return typeof value === "number" && !Number.isFinite(value) ? undefined : stringify(value);
  }
  if (isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index++) {
      const item = canonicalJson(hasOwn(value, index) ? value[index] : null, depth + 1);
      if (item === undefined) return undefined;
      items.push(item);
    }
    return `[${items.join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries: string[] = [];
  for (const key of objectKeys(record).sort()) {
    if (record[key] === undefined) continue;
    const item = canonicalJson(record[key], depth + 1);
    if (item === undefined) return undefined;
    entries.push(`${stringify(key)}:${item}`);
  }
  return `{${entries.join(",")}}`;
}

export function createExecutorSkillObservation(): ExecutorSkillObservation {
  const recorded = createPrivateMap<string, RecordedBody | null>();
  const observed = createPrivateMap<string, ProviderObservedSkillBody>();
  return {
    recordToolResult(toolName, toolCallId, result) {
      if (!toolCallId || !isLoadSkillToolName(toolName)) return;
      // A repeated call ID is ambiguous provenance and never becomes observable.
      if (recorded.has(toolCallId)) {
        recorded.set(toolCallId, null);
        return;
      }
      const skillId = extractSkillId(result);
      const references = extractSkillToolAvailability(result)?.references;
      const content = canonicalJson(result);
      recorded.set(
        toolCallId,
        skillId === undefined || references === undefined || content === undefined
          ? null
          : Object.freeze({ toolName, content, body: Object.freeze({ skillId, references }) }),
      );
    },
    observePrompt(prompt) {
      for (let index = 0; index < prompt.length; index++) {
        if (!hasOwn(prompt, index)) continue;
        const message = prompt[index]!;
        if (message.role !== "tool" || !isArray(message.content)) continue;
        for (const part of message.content) {
          if (part?.type !== "tool-result" || typeof part.toolCallId !== "string") continue;
          const entry = recorded.get(part.toolCallId);
          if (!entry || part.toolName !== entry.toolName) continue;
          const output = part.output as { type?: unknown; value?: unknown } | undefined;
          if (output?.type !== "json" || canonicalJson(output.value) !== entry.content) continue;
          observed.set(part.toolCallId, entry.body);
        }
      }
    },
    observedSkillBodies: () => [...observed.values()],
  };
}
