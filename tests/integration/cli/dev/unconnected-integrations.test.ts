import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readAgentSources } from "../../../../cli/commands/dev/unconnected-integrations.ts";

describe("dev integration source discovery", () => {
  it("reads agent sources from flat files and agent directories", async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${dir}/agents/case-dispose/tools`, { recursive: true });
      await Deno.writeTextFile(`${dir}/agents/case-ingest.ts`, "salesforce__get_case");
      await Deno.writeTextFile(`${dir}/agents/case-dispose/AGENT.md`, "salesforce__update_case");
      await Deno.writeTextFile(`${dir}/agents/case-dispose/tools/note.ts`, "export {}");

      const sources = await readAgentSources(dir);
      assertEquals(
        sources.map((s) => s.agentId).sort(),
        ["case-dispose", "case-dispose", "case-ingest"],
      );
      assertEquals(await readAgentSources(`${dir}/missing`), []);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
