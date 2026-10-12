/**
 * Hosted runtimes mount the project filesystem read-only, so tasks get a real writable
 * scratch directory as `ctx.dataDir`. These cases touch the host filesystem on purpose,
 * so they live here rather than in hermetic unit tests.
 */
import "#veryfront/schemas/_test-setup.ts";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { captureNodeScratchFs, runTask } from "#veryfront/task/runner.ts";
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

  it("is removed and the result returned when the task replaces Promise.prototype.catch", async () => {
    let seen: string | undefined;
    const original = Promise.prototype.catch;
    let result: Awaited<ReturnType<typeof runTask>>;
    try {
      result = await runTask(
        {
          task: {
            id: "mutates",
            name: "mutates",
            definition: {
              run: (ctx: TaskContext) => {
                seen = ctx.dataDir;
                Promise.prototype.catch = () => {
                  throw new Error("task-replaced catch");
                };
                return "done";
              },
            },
          },
        },
        createInMemoryHostRuntime(),
      );
    } finally {
      Promise.prototype.catch = original;
    }

    assertEquals(result.success, true);
    assertEquals(result.result, "done");
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

  it("classifies and redacts a failure after task code replaces regex and string hooks", async () => {
    const originalExec = RegExp.prototype.exec;
    const originalReplace = Object.getOwnPropertyDescriptor(String.prototype, Symbol.replace);
    let seen: string | undefined;
    const task = {
      id: "hooks",
      name: "hooks",
      definition: {
        run: (ctx: TaskContext) => {
          seen = ctx.dataDir;
          RegExp.prototype.exec = () => {
            throw new Error("hostile exec");
          };
          Object.defineProperty(String.prototype, Symbol.replace, {
            configurable: true,
            writable: true,
            value: () => {
              throw new Error("hostile replace");
            },
          });
          throw new Error(`Read-only file system (os error 30): open '${ctx.dataDir}/x'`);
        },
      },
    };

    try {
      const result = await runTask({ task }, createInMemoryHostRuntime());

      assertEquals(result.success, false);
      assertEquals(result.errorCode, "TASK_FILESYSTEM_READ_ONLY");
      assertEquals(result.error?.includes(seen!), false);
      assertEquals(result.error?.includes("'<task data dir>/x'"), true);
    } finally {
      RegExp.prototype.exec = originalExec;
      if (originalReplace) {
        Object.defineProperty(String.prototype, Symbol.replace, originalReplace);
      } else delete (String.prototype as unknown as Record<symbol, unknown>)[Symbol.replace];
    }
  });

  it("keeps using the native temp directory after task code replaces Deno.makeTempDir", async () => {
    const victim = `${await Deno.makeTempDir()}/veryfront-task-project`;
    await Deno.mkdir(victim);
    const original = Deno.makeTempDir;
    let seen: string | undefined;
    try {
      Deno.makeTempDir = () => Promise.resolve(victim);
      const result = await runTask(
        {
          task: {
            id: "replaced-mkdtemp",
            name: "replaced-mkdtemp",
            definition: {
              run: (ctx: TaskContext) => {
                seen = ctx.dataDir;
              },
            },
          },
        },
        createInMemoryHostRuntime(),
      );

      assertEquals(result.success, true);
    } finally {
      Deno.makeTempDir = original;
    }
    assertEquals(typeof seen, "string");
    assertEquals(seen === victim, false);
    assertEquals(await pathExists(victim), true);
    assertEquals(await pathExists(seen!), false);
  });

  it("creates and removes Node scratch directories under the temp root", async () => {
    const scratchFs = await captureNodeScratchFs();
    const os = await import("node:os");
    const dir = await scratchFs.makeTempDir({ prefix: "veryfront-task-" });

    assertEquals(dir.startsWith(os.tmpdir()), true);
    assertEquals(await pathExists(dir), true);
    await Deno.writeTextFile(`${dir}/state.json`, "{}");
    await scratchFs.remove(dir, { recursive: true });
    assertEquals(await pathExists(dir), false);
  });
});
