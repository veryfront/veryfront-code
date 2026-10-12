/**
 * Hosted runtimes mount the project filesystem read-only, so tasks get a real writable
 * scratch directory as `ctx.dataDir`. These cases touch the host filesystem on purpose,
 * so they live here rather than in hermetic unit tests.
 */
import "#veryfront/schemas/_test-setup.ts";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runTask } from "#veryfront/task/runner.ts";
import type { TaskContext } from "#veryfront/task/types.ts";

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

describe("task ctx.dataDir", () => {
  it("is writable during the run and removed after it", async () => {
    let seen: string | undefined;
    const result = await runTask(
      {
        task: {
          id: "sync",
          name: "sync",
          definition: {
            run: async (ctx: TaskContext) => {
              seen = ctx.dataDir;
              await Deno.mkdir(`${ctx.dataDir}/core`, { recursive: true });
              await Deno.writeTextFile(`${ctx.dataDir}/core/state.json`, "{}");
              return await Deno.readTextFile(`${ctx.dataDir}/core/state.json`);
            },
          },
        },
      },
      createInMemoryHostRuntime(),
    );

    assertEquals(result.success, true);
    assertEquals(result.result, "{}");
    assertEquals(typeof seen, "string");
    assertEquals(await pathExists(seen!), false);
  });

  it("is removed after a failed run", async () => {
    let seen: string | undefined;
    const result = await runTask(
      {
        task: {
          id: "fails",
          name: "fails",
          definition: {
            run: async (ctx: TaskContext) => {
              seen = ctx.dataDir;
              await Deno.writeTextFile(`${ctx.dataDir}/partial.json`, "{}");
              throw new Error("boom");
            },
          },
        },
      },
      createInMemoryHostRuntime(),
    );

    assertEquals(result.errorCode, "TASK_EXECUTION_FAILED");
    assertEquals(await pathExists(seen!), false);
  });
});
