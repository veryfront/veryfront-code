import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { clearProjectAgentRuntimeRegistries } from "#veryfront/agent/project/agent-runtime.ts";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { setJsonMode } from "../../shared/json-output.ts";
import type { ParsedArgs } from "../../shared/types.ts";
import { handleWebhookCommand } from "./handler.ts";

// Derived from the module URL rather than load-time Deno.cwd(): under
// `deno test --parallel` this module can be evaluated while a sibling test
// file is chdir'd into a soon-to-be-deleted temp directory.
const originalCwd = new URL("../../../", import.meta.url);
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

describe("webhook command", () => {
  afterEach(() => {
    Deno.chdir(originalCwd);
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

      Deno.chdir(projectDir);
      const result = await runCommand({
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
      Deno.chdir(originalCwd);
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

      Deno.chdir(projectDir);
      const result = await runCommand({
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
      Deno.chdir(originalCwd);
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
});
