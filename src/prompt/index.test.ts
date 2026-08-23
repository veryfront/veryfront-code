import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as factoryModule from "./factory.ts";
import * as promptModule from "./index.ts";
import * as publicPromptModule from "veryfront/prompt";
import * as registryModule from "./registry.ts";

const expectedRuntimeExports = ["prompt", "promptRegistry"];

describe("prompt/index.ts exports", () => {
  it("preserves the runtime export surface for veryfront/prompt", () => {
    assertEquals(Object.keys(promptModule).sort(), expectedRuntimeExports);
    assertEquals(Object.keys(publicPromptModule).sort(), expectedRuntimeExports);
  });

  it("keeps public exports wired to their owning modules", () => {
    assertStrictEquals(promptModule.prompt, factoryModule.prompt);
    assertStrictEquals(promptModule.promptRegistry, registryModule.promptRegistry);
    assertStrictEquals(publicPromptModule.prompt, promptModule.prompt);
    assertStrictEquals(
      publicPromptModule.promptRegistry,
      promptModule.promptRegistry,
    );
  });
});
