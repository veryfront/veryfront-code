import "#veryfront/schemas/_test-setup.ts";
import { prompt } from "#veryfront/prompt/factory.ts";
import { promptRegistry, promptRegistryInternal } from "#veryfront/prompt/registry.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import {
  DiscoveryGenerationError,
  replaceDiscoveredProjectPrimitives,
} from "./registry-replacement.ts";

describe("replaceDiscoveredProjectPrimitives", () => {
  beforeEach(() => promptRegistryInternal.clearAll());
  afterEach(() => promptRegistryInternal.clearAll());
  afterAll(() => stopEsbuild());

  it("rolls back a failed generation and publishes the next complete generation", async () => {
    const adapter = createMockAdapter();
    const stable = prompt({
      id: "stable",
      description: "Last known good prompt",
      content: "stable",
    });
    promptRegistry.register(stable.id, stable);
    const storedStable = promptRegistry.get("stable");

    await adapter.fs.writeFile(
      "/project/prompts/broken.ts",
      "throw new Error('broken prompt module');",
    );

    const config = {
      baseDir: "/project",
      fsAdapter: adapter.fs,
      toolDirs: [],
      agentDirs: [],
      skillDirs: [],
      resourceDirs: [],
      promptDirs: ["prompts"],
      workflowDirs: [],
      taskDirs: [],
      scheduleDirs: [],
      webhookDirs: [],
      evalDirs: [],
      allowHostProjectCodeExecution: true,
    };
    const failure = await assertRejects(
      () => replaceDiscoveredProjectPrimitives(config),
      DiscoveryGenerationError,
      "rejected with 1 error",
    );

    assertInstanceOf(failure, DiscoveryGenerationError);
    assertEquals(failure.result.errors[0]?.error instanceof Error, true);
    assertStrictEquals(promptRegistry.get("stable"), storedStable);
    assertEquals(promptRegistry.get("broken"), undefined);

    await adapter.fs.writeFile(
      "/project/prompts/broken.ts",
      [
        'import { prompt } from "veryfront/prompt";',
        'export default prompt({ description: "Recovered", content: "ok" });',
      ].join("\n"),
    );

    const recovered = await replaceDiscoveredProjectPrimitives(config);
    assertEquals(recovered.errors, []);
    assertStrictEquals(promptRegistry.get("stable"), storedStable);
    assertEquals(promptRegistry.get("broken")?.description, "Recovered");
  });

  it("can atomically publish the valid subset for an error-reporting runtime", async () => {
    const adapter = createMockAdapter();
    const stable = prompt({
      id: "stable",
      description: "Previous prompt",
      content: "stable",
    });
    promptRegistry.register(stable.id, stable);
    const storedStable = promptRegistry.get("stable");

    await adapter.fs.writeFile(
      "/project/prompts/valid.ts",
      [
        'import { prompt } from "veryfront/prompt";',
        'export default prompt({ description: "Valid", content: "ok" });',
      ].join("\n"),
    );
    await adapter.fs.writeFile(
      "/project/prompts/broken.ts",
      "throw new Error('broken prompt module');",
    );

    const result = await replaceDiscoveredProjectPrimitives({
      baseDir: "/project",
      fsAdapter: adapter.fs,
      toolDirs: [],
      agentDirs: [],
      skillDirs: [],
      resourceDirs: [],
      promptDirs: ["prompts"],
      workflowDirs: [],
      taskDirs: [],
      scheduleDirs: [],
      webhookDirs: [],
      evalDirs: [],
      allowHostProjectCodeExecution: true,
    }, { errorPolicy: "publish-valid" });

    assertEquals(result.errors.length, 1);
    assertStrictEquals(promptRegistry.get("stable"), storedStable);
    assertEquals(promptRegistry.get("valid")?.description, "Valid");
    assertEquals(promptRegistry.get("broken"), undefined);
  });
});
