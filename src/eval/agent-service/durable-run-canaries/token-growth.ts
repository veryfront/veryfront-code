import type { DurableRunCanaryCase, DurableRunCanaryPreparedCase } from "./runner.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import {
  assertCompleted,
  assertNoMalformedCreateFileToolCalls,
  collectAssistantText,
  findAssistantMessage,
} from "./validation.ts";

/** Marker used by the durable run token-growth canary prompt. */
export const DURABLE_RUN_TOKEN_GROWTH_CANARY_MARKER = "VF_DURABLE_TOKEN_GROWTH_CANARY";

const SAFE_CANARY_MARKER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Input payload for create durable run token-growth canary case. */
export type DurableRunTokenGrowthCanaryCaseInput = {
  conversationId?: string;
  cleanup?: DurableRunCanaryPreparedCase["cleanup"];
  marker?: string;
};

function buildTokenGrowthSetupPrompt(marker: string): string {
  return [
    "Durable run token-growth canary setup.",
    "If file tools are available, create or update `.veryfront-token-growth-canary.txt` with:",
    `- first line: ${marker}`,
    "- then 4000 short numbered lines that include the marker",
    "Reply briefly when the setup work is done.",
  ].join("\n");
}

function buildTokenGrowthFollowUpPrompt(marker: string): string {
  return [
    "Durable run token-growth canary follow-up.",
    `Use the prior conversation context for ${marker}, but do not edit files.`,
    "Reply with a brief completion confirmation.",
  ].join("\n");
}

/** Create a two-turn durable run canary for historical tool-input token growth. */
export function createDurableRunTokenGrowthCanaryCase(
  input: DurableRunTokenGrowthCanaryCaseInput = {},
): DurableRunCanaryCase {
  const marker = input.marker ?? `${DURABLE_RUN_TOKEN_GROWTH_CANARY_MARKER}_${crypto.randomUUID()}`;
  if (!SAFE_CANARY_MARKER_PATTERN.test(marker)) {
    throw INVALID_ARGUMENT.create({
      detail: "Durable token-growth canary marker must be 1-128 safe identifier characters",
    });
  }
  if (input.conversationId !== undefined && !UUID_PATTERN.test(input.conversationId)) {
    throw INVALID_ARGUMENT.create({
      detail: "Durable token-growth canary conversationId must be a UUID",
    });
  }

  return {
    id: "durable-token-growth-follow-up",
    label: "Durable run historical tool-input token growth follow-up",
    prepare: async () => ({
      cleanup: input.cleanup ?? (async () => {}),
      conversationId: input.conversationId ?? crypto.randomUUID(),
      followUpPrompt: buildTokenGrowthFollowUpPrompt(marker),
      prompt: buildTokenGrowthSetupPrompt(marker),
      title: "Durable run token-growth follow-up",
      validate: ({ messages, run }) => {
        assertCompleted(run);
        assertNoMalformedCreateFileToolCalls(messages);

        const assistant = findAssistantMessage(messages, run.messageId);
        const assistantText = collectAssistantText(assistant).trim();
        if (!assistantText) {
          throw INVALID_ARGUMENT.create({
            detail: "Expected follow-up durable run to persist assistant text",
          });
        }
      },
    }),
  };
}
