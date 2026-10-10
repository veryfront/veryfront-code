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

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Key-sorted JSON so the host and the prompt compare the same value, not its spelling. */
function canonicalJson(value: unknown, depth = 0): string | undefined {
  if (depth > MAX_CANONICAL_DEPTH) return undefined;
  if (value === null || typeof value !== "object") {
    return typeof value === "number" && !Number.isFinite(value) ? undefined : stringify(value);
  }
  return isArray(value)
    ? canonicalArray(value, depth)
    : canonicalRecord(value as Record<string, unknown>, depth);
}

function canonicalArray(value: readonly unknown[], depth: number): string | undefined {
  const items: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = canonicalJson(hasOwn(value, index) ? value[index] : null, depth + 1);
    if (item === undefined) return undefined;
    items.push(item);
  }
  return `[${items.join(",")}]`;
}

function canonicalRecord(record: Record<string, unknown>, depth: number): string | undefined {
  const entries: string[] = [];
  for (const key of objectKeys(record).sort(compareCodeUnits)) {
    if (record[key] === undefined) continue;
    const item = canonicalJson(record[key], depth + 1);
    if (item === undefined) return undefined;
    entries.push(`${stringify(key)}:${item}`);
  }
  return `{${entries.join(",")}}`;
}

/** The recorded body when this prompt part carries exactly the result the host delivered. */
function matchRecordedBody(
  part: unknown,
  recorded: ReadonlyMap<string, RecordedBody | null>,
): RecordedBody | undefined {
  const candidate = part as {
    type?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    output?: { type?: unknown; value?: unknown };
  } | null;
  if (candidate?.type !== "tool-result" || typeof candidate.toolCallId !== "string") {
    return undefined;
  }
  const entry = recorded.get(candidate.toolCallId);
  if (!entry || candidate.toolName !== entry.toolName) return undefined;
  const output = candidate.output;
  if (output?.type !== "json" || canonicalJson(output.value) !== entry.content) return undefined;
  return entry;
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
          const entry = matchRecordedBody(part, recorded);
          if (entry) observed.set(part.toolCallId, entry.body);
        }
      }
    },
    observedSkillBodies: () => [...observed.values()],
  };
}
