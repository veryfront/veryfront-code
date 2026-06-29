import { withProjectSourceContext } from "#cli/shared/project-source-context";
import type { ParsedArgs } from "#cli/shared/types";
import { discoverWebhooks, type WebhookDefinition } from "veryfront/webhook";
import { outputTriggerList } from "../trigger-utils.ts";

function formatWebhook(webhook: WebhookDefinition): string {
  return `${webhook.id} -> ${webhook.target.kind}:${webhook.target.id}`;
}

export async function handleWebhooksCommand(_args: ParsedArgs): Promise<void> {
  const projectDir = Deno.cwd();
  await withProjectSourceContext(projectDir, async ({ adapter, config }) => {
    const result = await discoverWebhooks({ projectDir, adapter, config });
    await outputTriggerList({
      command: "webhooks",
      items: result.items,
      errors: result.errors,
      formatItem: formatWebhook,
    });
  });
}
