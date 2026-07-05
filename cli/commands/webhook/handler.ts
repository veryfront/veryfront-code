import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { withProjectSourceContext } from "#cli/shared/project-source-context";
import type { ParsedArgs } from "#cli/shared/types";
import { exitProcess } from "#cli/utils";
import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { runTriggerTarget } from "veryfront/trigger";
import { discoverWebhooks } from "veryfront/webhook";
import { outputTriggerRun, readJsonFile } from "../trigger-utils.ts";

const getWebhookArgsSchema = defineSchema((v) =>
  v.object({
    action: v.literal("run"),
    id: v.string(),
    payload: v.string(),
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

export async function handleWebhookCommand(args: ParsedArgs): Promise<void> {
  const opts: WebhookArgs = parseArgsOrThrow(parseWebhookArgs, "webhook", args);
  const projectDir = Deno.cwd();
  const payload = await readJsonFile(opts.payload, "--payload JSON file");

  await withProjectSourceContext(projectDir, async (context) => {
    const { adapter, config, configCacheKey, projectId } = context;
    const result = await discoverWebhooks({ projectDir, adapter, config });
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
