import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { toolRegistry } from "#veryfront/tool";
import { agentRegistry } from "./composition/index.ts";
import { agent } from "./factory.ts";

describe("agent factory", () => {
  beforeEach(() => {
    agentRegistry.clearAll();
    toolRegistry.clearAll();
  });

  it("derives load_skill from skills without user-authored tools config", () => {
    const assistant = agent({
      id: "skill-platform-tool-test",
      system: "Use skills when they match the task.",
      skills: ["code-review"],
    });

    assertEquals(assistant.config.tools, {
      load_skill: true,
      load_skill_reference: true,
      execute_skill_script: true,
    });
    assertEquals(toolRegistry.has("load_skill"), true);
    assertEquals(toolRegistry.has("load-skill"), false);
  });
});
