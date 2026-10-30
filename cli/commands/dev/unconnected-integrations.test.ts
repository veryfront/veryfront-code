import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectDeclaredIntegrations,
  readAgentSources,
  unconnectedIntegrationLines,
} from "./unconnected-integrations.ts";

const caseIngest = {
  agentId: "case-ingest",
  source: `tools: { salesforce__get_case: true, gmail__list_emails: true }`,
};
const caseDispose = {
  agentId: "case-dispose",
  source: `tools: { salesforce__update_case: true }`,
};

describe("commands/dev/unconnected-integrations", () => {
  it("collects declared integrations with the agents that use them", () => {
    assertEquals(collectDeclaredIntegrations([caseIngest, caseDispose]), [
      { integration: "gmail", agentIds: ["case-ingest"] },
      { integration: "salesforce", agentIds: ["case-dispose", "case-ingest"] },
    ]);
  });

  it("ignores names that are not catalog integrations", () => {
    assertEquals(
      collectDeclaredIntegrations([{ agentId: "a", source: "tools: { my_helper__run: true }" }]),
      [],
    );
  });

  it("prints a line for every integration without a connected tool", () => {
    assertEquals(
      unconnectedIntegrationLines(
        collectDeclaredIntegrations([caseIngest, caseDispose]),
        ["gmail__list_emails"],
      ),
      [
        "Salesforce isn't connected. Agents case-dispose and case-ingest need it.",
        "  Connect: npx veryfront integration connect salesforce",
      ],
    );
  });

  it("uses the singular for one agent", () => {
    assertEquals(
      unconnectedIntegrationLines(collectDeclaredIntegrations([caseDispose]), []),
      [
        "Salesforce isn't connected. Agent case-dispose needs it.",
        "  Connect: npx veryfront integration connect salesforce",
      ],
    );
  });

  it("prints nothing when every declared integration is connected", () => {
    assertEquals(
      unconnectedIntegrationLines(
        collectDeclaredIntegrations([caseIngest, caseDispose]),
        ["gmail__list_emails", "salesforce__get_case"],
      ),
      [],
    );
  });

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
