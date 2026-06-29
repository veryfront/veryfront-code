import { isTriggerTarget } from "#veryfront/trigger/target.ts";
import { assertSerializable, validateTriggerId } from "#veryfront/trigger/validation.ts";
import type {
  WebhookConfig,
  WebhookDefinition,
  WebhookEventFilter,
  WebhookEventFilterCondition,
} from "./types.ts";

const OPERATORS = new Set(["equals", "not_equals", "contains", "exists"]);

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function normalizeFilter(filter: WebhookEventFilter | undefined): WebhookEventFilter | undefined {
  if (filter === undefined) return undefined;
  if (filter.mode !== "all" && filter.mode !== "any") {
    throw new Error("Webhook eventFilter mode must be all or any.");
  }
  if (!Array.isArray(filter.conditions)) {
    throw new Error("Webhook eventFilter conditions must be an array.");
  }

  return {
    mode: filter.mode,
    conditions: filter.conditions.map((condition, index): WebhookEventFilterCondition => {
      if (typeof condition.path !== "string" || condition.path.trim().length === 0) {
        throw new Error(`Webhook eventFilter condition ${index} path is required.`);
      }
      if (!OPERATORS.has(condition.operator)) {
        throw new Error(`Webhook eventFilter condition ${index} operator is not supported.`);
      }
      assertSerializable(condition.value, `Webhook eventFilter condition ${index} value`);
      return {
        path: condition.path,
        operator: condition.operator,
        ...(condition.value === undefined ? {} : { value: condition.value }),
      };
    }),
  };
}

export function webhook(config: WebhookConfig): WebhookDefinition {
  const id = requireString(config.id, "Webhook id");
  validateTriggerId(id, "Webhook");

  if (!isTriggerTarget(config.target)) {
    throw new Error("Webhook target must specify a valid task, workflow, or agent id.");
  }

  if (
    config.target.kind === "agent" &&
    (!config.agentMessage || config.agentMessage.promptTemplate.trim().length === 0)
  ) {
    throw new Error("Agent webhooks must define agentMessage.promptTemplate.");
  }

  const eventFilter = normalizeFilter(config.eventFilter);

  return {
    id,
    ...(config.name === undefined ? {} : { name: config.name }),
    ...(config.description === undefined ? {} : { description: config.description }),
    target: { kind: config.target.kind, id: config.target.id },
    ...(eventFilter === undefined ? {} : { eventFilter }),
    ...(config.agentMessage === undefined
      ? {}
      : { agentMessage: { promptTemplate: config.agentMessage.promptTemplate } }),
  };
}
