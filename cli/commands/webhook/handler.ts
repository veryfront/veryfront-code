import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { withProjectSourceContext } from "#cli/shared/project-source-context";
import type { ParsedArgs } from "#cli/shared/types";
import { exitProcess } from "#cli/utils";
import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { runTriggerTarget } from "veryfront/trigger";
import { discoverWebhooks, type WebhookDefinition } from "veryfront/webhook";
import { outputTriggerList, outputTriggerRun, readJsonFile } from "../trigger-utils.ts";
import { INVALID_ARGUMENT } from "veryfront/errors";

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

    const webhook = result.items.find((candidate) => candidate.id === opts.id);
    if (!webhook) {
      throw new Error(`Webhook "${opts.id}" not found.`);
    }

    const run = await runTriggerTarget({
      projectDir,
      adapter,
      config,
      cacheKey: configCacheKey,
      projectId,
      target: webhook.target,
      input: payload,
      debug: opts.debug,
    });

    await outputTriggerRun({
      command: "webhook",
      triggerId: webhook.id,
      target: webhook.target,
      output: run.output,
      durationMs: run.durationMs,
    });
  }).catch((error: unknown) => {
    throw error;
  });

  exitProcess(0);
}
