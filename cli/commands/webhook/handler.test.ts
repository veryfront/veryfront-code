import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { clearProjectAgentRuntimeRegistries } from "#veryfront/agent/project/agent-runtime.ts";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { VeryfrontError } from "veryfront/errors";
import { withCwd } from "#veryfront/testing/cwd.ts";
import { setJsonMode } from "../../shared/json-output.ts";
import type { ParsedArgs } from "../../shared/types.ts";
import { handleWebhookCommand, toWebhookAgentOptions } from "./handler.ts";

const originalExit = Deno.exit;
const originalConsoleLog = console.log;

class ExitSentinel extends Error {
  constructor(readonly code: number) {
    super(`exit:${code}`);
  }
}

async function runCommand(args: ParsedArgs): Promise<{
  exitCode: number | undefined;
  output: string[];
}> {
  const output: string[] = [];
  setJsonMode(true);
  console.log = (...values: unknown[]) => output.push(values.map(String).join(" "));
  // deno-lint-ignore no-explicit-any
  (Deno as any).exit = (code = 0) => {
    throw new ExitSentinel(code);
  };

  let exitCode: number | undefined;
  try {
    await handleWebhookCommand(args);
  } catch (error) {
    if (!(error instanceof ExitSentinel)) throw error;
    exitCode = error.code;
  }
  return { exitCode, output };
}

function runCommandInProjectCwd(
  projectDir: string,
  args: ParsedArgs,
): Promise<{
  exitCode: number | undefined;
  output: string[];
}> {
  return withCwd(projectDir, () => runCommand(args));
}

describe("webhook command", () => {
  afterEach(() => {
    // No chdir here: withCwd already handed the directory back, and reaching
    // for it outside a turn would yank it from whichever test file holds it now.
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = originalExit;
    console.log = originalConsoleLog;
    setJsonMode(false);
    clearProjectAgentRuntimeRegistries();
    clearTranspileCache();
  });

  afterAll(async () => {
    await stopEsbuild();
  });

  it("reports a filtered fixture without discovering or running its target", async () => {
    const projectDir = await Deno.makeTempDir({
      prefix: "vf-webhook-filtered-",
    });
    try {
      await Deno.mkdir(`${projectDir}/webhooks`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        "export default {};\n",
      );
      await Deno.writeTextFile(
        `${projectDir}/webhooks/pull-request.ts`,
        [
          'import { webhook } from "veryfront/webhook";',
          "export default webhook({",
          '  id: "pull-request",',
          '  target: { kind: "task", id: "target-must-not-run" },',
          "  eventFilter: {",
          '    mode: "all",',
          "    conditions: [",
          '      { path: "action", operator: "equals", value: "opened" },',
          "    ],",
          "  },",
          "});",
          "",
        ].join("\n"),
      );
      await Deno.writeTextFile(
        `${projectDir}/closed.json`,
        JSON.stringify({ action: "closed" }),
      );

      const result = await runCommandInProjectCwd(projectDir, {
        _: ["webhook", "run", "pull-request"],
        payload: "closed.json",
        json: true,
      } as ParsedArgs);

      assertEquals(result.exitCode, 0);
      assertEquals(JSON.parse(result.output.at(-1) ?? "{}"), {
        success: true,
        command: "webhook",
        data: {
          command: "webhook",
          triggerId: "pull-request",
          target: { kind: "task", id: "target-must-not-run" },
          matched: false,
          status: "ignored",
          reason: "Webhook event did not match configured filter",
        },
      });
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("renders an agent prompt and isolates the payload in local context", async () => {
    const projectDir = await Deno.makeTempDir({
      prefix: "vf-webhook-agent-",
    });
    try {
      await Deno.mkdir(`${projectDir}/webhooks`, { recursive: true });
      await Deno.mkdir(`${projectDir}/agents`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        "export default {};\n",
      );
      await Deno.writeTextFile(
        `${projectDir}/webhooks/pull-request.ts`,
        [
          'import { webhook } from "veryfront/webhook";',
          "export default webhook({",
          '  id: "pull-request",',
          '  target: { kind: "agent", id: "capture-agent" },',
          "  agentMessage: {",
          '    promptTemplate: "Review {{payload.pull_request.title}} ({{payload.action}}).",',
          "  },",
          "});",
          "",
        ].join("\n"),
      );
      await Deno.writeTextFile(
        `${projectDir}/agents/capture-agent.ts`,
        [
          'import { agent } from "veryfront/agent";',
          "",
          "const captureAgent = agent({",
          '  id: "capture-agent",',
          '  model: "openai/gpt-5.4-nano",',
          '  system: "Capture the local webhook invocation.",',
          "});",
          "captureAgent.generate = async ({ input, context }) => ({",
          "  text: JSON.stringify({ input, context }),",
          '  status: "completed",',
          "  toolCalls: [],",
          "});",
          "",
          "export default captureAgent;",
          "",
        ].join("\n"),
      );
      await Deno.writeTextFile(
        `${projectDir}/opened.json`,
        JSON.stringify({
          action: "opened",
          pull_request: { title: "Harden webhooks" },
        }),
      );

      const result = await runCommandInProjectCwd(projectDir, {
        _: ["webhook", "run", "pull-request"],
        payload: "opened.json",
        json: true,
      } as ParsedArgs);

      assertEquals(result.exitCode, 0);
      const envelope = JSON.parse(result.output.at(-1) ?? "{}");
      assertEquals(JSON.parse(envelope.data.output.text), {
        input: "Review Harden webhooks (opened).",
        context: {
          trigger: "webhook",
          webhook: { id: "pull-request", name: "pull-request" },
          forwardedProps: {
            source: "webhook",
            source_trigger_id: "pull-request",
            payload: {
              action: "opened",
              pull_request: { title: "Harden webhooks" },
            },
          },
        },
      });
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects an invalid id before trying to read its fixture", async () => {
    await assertRejects(
      () =>
        handleWebhookCommand({
          _: ["webhook", "run", "Invalid ID"],
          payload: "missing.json",
        } as ParsedArgs),
      Error,
      'Invalid webhook id: "Invalid ID".',
    );
  });

  it("reports local-only agent webhook usage failures as invalid arguments", () => {
    const existingConversationError = assertThrows(
      () =>
        toWebhookAgentOptions(
          {
            definition: {
              id: "pull-request",
              target: { kind: "agent", id: "capture-agent" },
              agentMessage: { conversationMode: "existing" },
            },
            payload: {},
            matched: true,
            targetInput: {},
            agentInput: "Review the payload.",
          } as unknown as Parameters<typeof toWebhookAgentOptions>[0],
        ),
      VeryfrontError,
      "Local agent webhook runs cannot attach to an existing cloud conversation.",
    );
    assertInstanceOf(existingConversationError, VeryfrontError);
    assertEquals(existingConversationError.slug, "invalid-argument");

    const missingPromptError = assertThrows(
      () =>
        toWebhookAgentOptions(
          {
            definition: {
              id: "pull-request",
              target: { kind: "agent", id: "capture-agent" },
            },
            payload: {},
            matched: true,
            targetInput: {},
          } as unknown as Parameters<typeof toWebhookAgentOptions>[0],
        ),
      VeryfrontError,
      "Local agent webhook runs require a rendered prompt.",
    );
    assertInstanceOf(missingPromptError, VeryfrontError);
    assertEquals(missingPromptError.slug, "invalid-argument");
  });
});
