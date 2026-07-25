import { assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";

interface DenoConfig {
  readonly tasks?: Readonly<Record<string, string>>;
}

const COMPILED_BINARY_TEST = "tests/integration/compiled-binary-e2e.test.ts";
const VFS_PROXY_BINARY_TEST = "tests/integration/vfs-proxy-mode-e2e.test.ts";

Deno.test("compiled-binary E2E coverage is isolated from parallel suites without being skipped", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as DenoConfig;
  const tasks = config.tasks;
  assertExists(tasks, "deno.json must define test tasks");

  for (
    const taskName of [
      "test",
      "test:integration",
      "test:coverage",
      "test:coverage:integration",
    ]
  ) {
    const task: string | undefined = tasks[taskName];
    assertExists(task, `deno.json must define ${taskName}`);
    assertStringIncludes(
      task,
      COMPILED_BINARY_TEST,
      `${taskName} must isolate the heavyweight compiled-binary suite`,
    );
    assertStringIncludes(
      task,
      VFS_PROXY_BINARY_TEST,
      `${taskName} must isolate the heavyweight VFS proxy binary suite`,
    );
  }

  const binaryTask = tasks["test:e2e:binary"];
  assertExists(binaryTask, "deno.json must define test:e2e:binary");
  assertStringIncludes(
    binaryTask,
    "deno task test:e2e:binary:core",
    "the compiled-binary umbrella must retain core binary coverage",
  );
  assertStringIncludes(
    binaryTask,
    "deno task test:e2e:binary:vfs-proxy",
    "the compiled-binary umbrella must retain VFS proxy coverage",
  );

  const coreTask = tasks["test:e2e:binary:core"];
  assertExists(coreTask, "deno.json must define test:e2e:binary:core");
  assertStringIncludes(coreTask, COMPILED_BINARY_TEST);

  const proxyTask = tasks["test:e2e:binary:vfs-proxy"];
  assertExists(proxyTask, "deno.json must define test:e2e:binary:vfs-proxy");
  assertStringIncludes(proxyTask, VFS_PROXY_BINARY_TEST);

  const verifyTask = tasks.verify;
  assertExists(verifyTask, "deno.json must define verify");
  assertStringIncludes(
    verifyTask,
    "deno task test:e2e:binary",
    "repository verification must retain the compiled-binary umbrella",
  );
});
