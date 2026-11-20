import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { discoverAll } from "./discovery-engine.ts";

const config = {
  baseDir: "/project",
  allowHostProjectCodeExecution: true,
  toolDirs: [],
  skillDirs: [],
  resourceDirs: [],
  promptDirs: [],
  workflowDirs: [],
  taskDirs: [],
  scheduleDirs: [],
  webhookDirs: [],
  evalDirs: [],
};
describe("exact agent entrypoint discovery", () => {
  afterEach(() => agentRegistry.clear());
  afterAll(() => stopEsbuild());
  it("keeps the reserved top-level AGENT.md form unsupported", async () => {
    const adapter = createMockAdapter();
    await adapter.fs.writeFile(
      "/project/agents/AGENT.md",
      "---\nname: Invalid flat source\n---\nNot a directory agent.",
    );
    const result = await discoverAll({
      ...config,
      fsAdapter: adapter.fs,
      agentEntrypoint: { path: "agents/AGENT.md" },
    });
    assertEquals([...result.agents.keys()], []);
    assertEquals(result.errors.length > 0, true);
  });
  it("loads the selected markdown file without evaluating other agent modules", async () => {
    const adapter = createMockAdapter();
    await adapter.fs.writeFile(
      "/project/agents/selected.md",
      "---\nname: Selected\nmodel: openai/gpt-5.4\n---\nSelected instructions.",
    );
    await adapter.fs.writeFile(
      "/project/agents/private.ts",
      "throw new Error('Unselected agent was evaluated');",
    );
    const result = await discoverAll({
      ...config,
      fsAdapter: adapter.fs,
      agentEntrypoint: { path: "agents/selected.md" },
    });
    assertEquals(result.errors, []);
    assertEquals([...result.agents.keys()], ["selected"]);
    assertEquals(result.agents.get("selected")?.config.system, "Selected instructions.");
  });
  it("does not substitute another file when the selected entrypoint is missing", async () => {
    const adapter = createMockAdapter();
    await adapter.fs.writeFile(
      "/project/agents/selected.md",
      "---\nname: Unselected\n---\nWrong source.",
    );
    const result = await discoverAll({
      ...config,
      fsAdapter: adapter.fs,
      agentEntrypoint: { path: "agents/missing.md" },
    });
    assertEquals([...result.agents.keys()], []);
    assertEquals(result.errors.length > 0, true);
  });
  it("loads a nested exact file independently of configured discovery roots", async () => {
    const adapter = createMockAdapter();
    await adapter.fs.writeFile(
      "/project/agents/shared/selected.md",
      "---\nname: Nested\n---\nNested source.",
    );
    const result = await discoverAll({
      ...config,
      fsAdapter: adapter.fs,
      agentDirs: [],
      agentEntrypoint: { path: "agents/shared/selected.md" },
    });
    assertEquals(result.errors, []);
    assertEquals([...result.agents.keys()], ["selected"]);
  });
  it("loads the selected TypeScript module instead of a same-id markdown sibling", async () => {
    const adapter = createMockAdapter();
    await adapter.fs.writeFile(
      "/project/agents/selected.ts",
      'import { agent } from "veryfront/agent"; export default agent({ id: "selected", system: "Code source." });',
    );
    await adapter.fs.writeFile(
      "/project/agents/selected.md",
      "---\nname: Wrong sibling\n---\nWrong source.",
    );
    const result = await discoverAll({
      ...config,
      fsAdapter: adapter.fs,
      agentEntrypoint: { path: "agents/selected.ts" },
    });
    assertEquals(result.errors, []);
    assertEquals([...result.agents.keys()], ["selected"]);
    assertEquals(result.agents.get("selected")?.config.system, "Code source.");
  });
  for (const id of ["selected", "agents"]) {
    it(`loads a selected directory-agent definition named ${id}`, async () => {
      const adapter = createMockAdapter();
      await adapter.fs.writeFile(
        `/project/agents/${id}/AGENT.md`,
        "---\nname: Directory agent\n---\nDirectory source.",
      );
      const result = await discoverAll({
        ...config,
        fsAdapter: adapter.fs,
        agentEntrypoint: { path: `agents/${id}/AGENT.md` },
      });
      assertEquals(result.errors, []);
      assertEquals([...result.agents.keys()], [id]);
    });
  }
});
