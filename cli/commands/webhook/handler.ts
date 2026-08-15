import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { withProjectSourceContext } from "#cli/shared/project-source-context";
import type { ParsedArgs } from "#cli/shared/types";
import { cliLogger, exitProcess } from "#cli/utils";
import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { type AgentTriggerTarget, runTriggerTarget } from "veryfront/trigger";
import {
  discoverWebhooks,
  isWebhookId,
  type PreparedWebhookInvocation,
  prepareWebhookInvocation,
  type WebhookDefinition,
} from "veryfront/webhook";
import { outputTriggerList, outputTriggerRun, readJsonFile } from "../trigger-utils.ts";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { INVALID_ARGUMENT } from "veryfront/errors";

const FILTERED_REASON = "Webhook event did not match configured filter";

const getWebhookArgsSchema = defineSchema((v) =>
  v.object({
    action: v.enum(["run", "list"]).optional(),
    id: v.string().optional(),
    payload: v.string().optional(),
    debug: v.boolean().default(false),
  })
);

const WebhookArgsSchema = lazySchema(getWebhookArgsSchema);

type WebhookArgs = InferSchema<ReturnType<typeof getWebhookArgsSchema>>;

const parseWebhookArgs = createArgParser(WebhookArgsSchema, {
  action: { keys: ["action"], type: "string", positional: 0 },
  id: { keys: ["id"], type: "string", positional: 1 },
  payload: { keys: ["payload"], type: "string" },
  debug: { keys: ["debug"], type: "boolean" },
});

export function toWebhookAgentOptions(
  invocation: PreparedWebhookInvocation,
): {
  agentInput?: string;
  agentContext?: Record<string, unknown>;
} {
  const webhook = invocation.definition;
  if (webhook.target.kind !== "agent") return {};
  const agentTarget = webhook.target as AgentTriggerTarget;
  const conversationMode = agentTarget.conversationMode ??
    webhook.agentMessage?.conversationMode;
  if (conversationMode === "existing") {
    throw INVALID_ARGUMENT.create({
      detail: "Local agent webhook runs cannot attach to an existing cloud conversation.",
    });
  }
  if (typeof invocation.agentInput !== "string") {
    throw INVALID_ARGUMENT.create({
      detail: "Local agent webhook runs require a rendered prompt.",
    });
  }
  return {
    agentInput: invocation.agentInput,
    agentContext: {
      trigger: "webhook",
      webhook: {
        id: webhook.id,
        name: webhook.name ?? webhook.id,
      },
      forwardedProps: {
        source: "webhook",
        source_trigger_id: webhook.id,
        payload: invocation.payload,
      },
    },
  };
}

async function outputFilteredWebhook(
  webhook: WebhookDefinition,
): Promise<void> {
  const result = {
    command: "webhook",
    triggerId: webhook.id,
    target: webhook.target,
    matched: false,
    status: "ignored",
    reason: FILTERED_REASON,
  } as const;
  if (isJsonMode()) {
    await outputJson(createSuccessEnvelope("webhook", result));
    return;
  }
  cliLogger.info(
    `webhook "${webhook.id}" was ignored: ${FILTERED_REASON}`,
  );
}

function formatWebhook(webhook: WebhookDefinition): string {
  return `${webhook.id} -> ${webhook.target.kind}:${webhook.target.id}`;
}

async function handleWebhookList(_args: ParsedArgs): Promise<void> {
  const projectDir = Deno.cwd();
  await withProjectSourceContext(projectDir, async ({ adapter, config }) => {
    const result = await discoverWebhooks({
      projectDir,
      adapter,
      config,
      allowHostProjectCodeExecution: true,
    });
    await outputTriggerList({
      command: "webhooks",
      items: result.items,
      errors: result.errors,
      formatItem: formatWebhook,
    });
  });
}

export async function handleWebhookCommand(args: ParsedArgs): Promise<void> {
  const opts: WebhookArgs = parseArgsOrThrow(parseWebhookArgs, "webhook", args);

  // Dispatch "list" (also the default when no action is given)
  if (!opts.action || opts.action === "list") {
    await handleWebhookList(args);
    return;
  }

  // action === "run"
  if (!opts.id) {
    throw INVALID_ARGUMENT.create({ detail: "Usage: veryfront webhook run <id> --payload <file>" });
  }
  if (!opts.payload) {
    throw INVALID_ARGUMENT.create({ detail: "webhook run requires --payload <file>" });
  }
  if (!isWebhookId(opts.id)) {
    throw INVALID_ARGUMENT.create({ detail: `Invalid webhook id: "${opts.id}".` });
  }

  const projectDir = Deno.cwd();
  const payload = await readJsonFile(opts.payload, "--payload JSON file");

  await withProjectSourceContext(projectDir, async (context) => {
    const { adapter, config, configCacheKey, projectId } = context;
    const result = await discoverWebhooks({
      projectDir,
      adapter,
      config,
      allowHostProjectCodeExecution: true,
    });
    if (result.errors.length > 0) {
      throw new Error(`Webhook discovery failed: ${result.errors[0]?.message}`);
    }

    const discovered = result.items.find((candidate) => candidate.id === opts.id);
    if (!discovered) {
      throw new Error(`Webhook "${opts.id}" not found.`);
    }

    const invocation = prepareWebhookInvocation(discovered, payload);
    const webhook = invocation.definition;
    if (!invocation.matched) {
      await outputFilteredWebhook(webhook);
      return;
    }

    const run = await runTriggerTarget({
      projectDir,
      adapter,
      config,
      cacheKey: configCacheKey,
      projectId,
      target: webhook.target,
      input: invocation.targetInput,
      ...toWebhookAgentOptions(invocation),
      debug: opts.debug,
    });

    await outputTriggerRun({
      command: "webhook",
      triggerId: webhook.id,
      target: webhook.target,
      output: run.output,
      durationMs: run.durationMs,
    });
  });

  exitProcess(0);
}
