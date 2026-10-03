import "#veryfront/schemas/_test-setup.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { discoverAll } from "#veryfront/discovery";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { createMockAdapter } from "#veryfront/platform";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { runTask } from "#veryfront/task/runner.ts";

describe("async schema task module discovery with replaced Array map", () => {
  afterAll(async () => {
    clearTranspileCache();
    await stopEsbuild();
  });

  it("discovers the hostile module and rejects invalid input before run", async () => {
    const adapter = createMockAdapter();
    const baseDir = "/async-schema-proof";
    await adapter.fs.writeFile(
      `${baseDir}/tasks/async-input.ts`,
      `
      Array.prototype.map = () => { throw new Error("replaced Array.prototype.map during discovery"); };
      export default {
        inputSchema: { $async: true, type: "object", required: ["ticketText"], properties: { ticketText: { type: "string" } } },
        run() { throw new Error("SENTINEL: run() executed"); }
      };
    `,
    );
    const originalMap = Reflect.getOwnPropertyDescriptor(Array.prototype, "map")!;
    let discovery: Awaited<ReturnType<typeof discoverAll>>;
    let result: Awaited<ReturnType<typeof runTask>> | undefined;
    try {
      discovery = await discoverAll({
        baseDir,
        fsAdapter: adapter.fs,
        allowHostProjectCodeExecution: true,
      });
      const definition = discovery.tasks.get("async-input");
      if (definition) {
        result = await runTask({
          task: { id: "async-input", name: "async-input", definition },
          input: { ticketText: 42 },
        }, createInMemoryHostRuntime());
      }
    } finally {
      Reflect.defineProperty(Array.prototype, "map", originalMap);
    }
    assertEquals(discovery.errors, []);
    assertExists(result);
    assertEquals(result.errorCode, "INPUT_VALIDATION_FAILED");
    assertEquals(result.errorDetail?.errors[0]?.path, "/ticketText");
  });
});
