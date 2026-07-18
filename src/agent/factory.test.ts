import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { toolRegistry } from "#veryfront/tool";
import { agentRegistry } from "./composition/index.ts";
import { agent } from "./factory.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";

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

  it("rejects malformed respond payloads before starting the runtime", async () => {
    const assistant = agent({ id: "respond-validation", system: "Help." });
    const response = await assistant.respond(
      new Request("https://agent.example.com", {
        method: "POST",
        body: JSON.stringify({ messages: "invalid" }),
      }),
    );

    assertEquals(response.status, 400);
    assertEquals((await response.json()).error, "Invalid agent request");
  });

  it("rejects oversized respond payloads before starting the runtime", async () => {
    const assistant = agent({ id: "respond-size-limit", system: "Help." });
    const response = await assistant.respond(
      new Request("https://agent.example.com", {
        method: "POST",
        body: JSON.stringify({ padding: "x".repeat(DEFAULT_MAX_BODY_SIZE_BYTES) }),
      }),
    );

    assertEquals(response.status, 413);
    assertEquals((await response.json()).error, "Request body too large");
  });
});
