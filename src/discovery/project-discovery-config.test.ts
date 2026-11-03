import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveDevAgentDirs } from "./project-discovery-config.ts";

describe("discovery/project-discovery-config", () => {
  it("resolves the agent roots the dev server discovers", () => {
    assertEquals(resolveDevAgentDirs(undefined), ["agents"]);
    assertEquals(resolveDevAgentDirs({}), ["agents"]);
    assertEquals(resolveDevAgentDirs({ ai: { agents: { discovery: { paths: ["crew"] } } } }), [
      "crew",
    ]);
    assertEquals(resolveDevAgentDirs({ ai: { agents: { discovery: { paths: [] } } } }), []);
  });

  it("keeps the agent roots when discovery is switched off, as the dev server does", () => {
    assertEquals(resolveDevAgentDirs({ ai: { agents: { discovery: { enabled: false } } } }), [
      "agents",
    ]);
    assertEquals(
      resolveDevAgentDirs({ ai: { agents: { discovery: { enabled: false, paths: ["crew"] } } } }),
      ["crew"],
    );
  });
});
