import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { DurableRunHome } from "#veryfront/internal-agents/durable-run-home.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { parseAgentPauseCheckpoint } from "#veryfront/agent/runtime/manual-pause.ts";

for (const kind of ["local", "startup"]) {
  it(`first durable ${kind} tool result survives SIGKILL before the later pause boundary`, async () => {
    const directory = await makeTempDir();
    try {
      const child = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-all",
          "--frozen",
          new URL("./recovery-post-tool-crash-subprocess.ts", import.meta.url).pathname,
          directory,
          kind,
        ],
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const reader = child.stdout.getReader();
      const ready = await reader.read();
      if (ready.done) {
        throw new Error(
          `Child exited before checkpoint: ${await new Response(child.stderr).text()}`,
        );
      }
      assertEquals(new TextDecoder().decode(ready.value), "READY\n");
      child.kill("SIGKILL");
      await reader.cancel();
      reader.releaseLock();
      await new Response(child.stderr).text();
      assertEquals((await child.status).success, false);
      const home = await DurableRunHome.open({
        directory: `${directory}/post-tool`,
        identity: {
          projectId: "11111111-1111-4111-8111-111111111111",
          canonicalRunId: "22222222-2222-4222-8222-222222222222",
          publicRunId: "run-proof",
          agentId: "proof-agent",
          threadId: "77777777-7777-4777-8777-777777777777",
          sourceHash: "a".repeat(64),
        },
      });
      const value = (await home.read())[0]!.value;
      if (value === null || typeof value !== "object" || !("runtimeContinuation" in value)) {
        throw new Error("Missing crash checkpoint");
      }
      assertExists(
        value.runtimeContinuation,
        "The first acknowledged result must include its native continuation",
      );
      const continuation = parseAgentPauseCheckpoint(value.runtimeContinuation);
      assertEquals(continuation.nextStep, kind === "startup" ? 0 : 1);
      assertEquals(continuation.toolCalls[0]?.error, undefined);
      assertEquals(continuation.startupSkillLoaded, true);
      assertEquals(continuation.toolCalls.length, 1);
      assertEquals(continuation.toolCalls[0]!.status, "completed");
      const model = scriptedModel([(options) => {
        if (kind === "startup") {
          assertStringIncludes(JSON.stringify(options.prompt), "Crash guidance");
        }
        return { text: "Complete" };
      }], { only: "stream" });
      const runtime = new AgentRuntime("proof-agent", {
        model: "veryfront-cloud/openai/gpt-5.4",
        system: "Synthetic",
        maxSteps: 2,
        ...(kind === "startup"
          ? { bootstrapSkill: "crash-plan", skills: ["crash-plan"] }
          : { skills: false }),
      }, { resolveModelRuntime: () => model, recoveryContinuation: continuation });
      const output = await new Response(await runtime.stream([])).text();
      assertStringIncludes(output, "Complete");
      assertEquals(model.callCount, 1);
      if (kind === "local") assertEquals(await Deno.readTextFile(`${directory}/effects`), "one\n");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
}
