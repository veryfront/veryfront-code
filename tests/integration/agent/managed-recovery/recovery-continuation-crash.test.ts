import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { DurableRunHome } from "#veryfront/internal-agents/durable-run-home.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { parseAgentPauseCheckpoint } from "#veryfront/agent/runtime/manual-pause.ts";

it("actual safe loop checkpoint survives SIGKILL and replacement preserves step budget without repeating the tool", async () => {
  const directory = await makeTempDir();
  try {
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        "--frozen",
        new URL("./recovery-continuation-subprocess.ts", import.meta.url).pathname,
        directory,
      ],
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const reader = child.stdout.getReader();
    const ready = await reader.read();
    assertEquals(new TextDecoder().decode(ready.value), "READY\n");
    child.kill("SIGKILL");
    await reader.cancel();
    reader.releaseLock();
    await new Response(child.stderr).text();
    assertEquals((await child.status).success, false);
    const home = await DurableRunHome.open({
      directory: `${directory}/continuation`,
      identity: {
        projectId: "11111111-1111-4111-8111-111111111111",
        canonicalRunId: "22222222-2222-4222-8222-222222222222",
        publicRunId: "run-proof",
        sourceHash: "a".repeat(64),
      },
    });
    const continuation = parseAgentPauseCheckpoint((await home.read())[0]!.value);
    assertEquals(continuation.nextStep, 1);
    assertEquals(continuation.toolCalls.length, 1);
    assertEquals(continuation.toolCalls[0]!.id, "stable-effect");
    for (const maxSteps of [1, 2]) {
      const model = scriptedModel([{ text: "Complete" }], { only: "stream" });
      const runtime = new AgentRuntime("crash-proof", {
        model: "veryfront-cloud/openai/gpt-5.4",
        system: "Synthetic",
        skills: false,
        maxSteps,
      }, {
        resolveModelRuntime: () => model,
        recoveryContinuation: continuation,
      });
      await new Response(await runtime.stream([])).text();
      assertEquals(model.callCount, maxSteps === 1 ? 0 : 1);
      assertEquals(await Deno.readTextFile(`${directory}/effects`), "one\n");
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
