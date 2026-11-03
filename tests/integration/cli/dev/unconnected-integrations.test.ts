import "#veryfront/testing/init.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { discoverAll } from "#veryfront/discovery/index.ts";
import { createProjectDiscoveryConfig } from "#veryfront/discovery/project-discovery-config.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { createToolsFromRemoteDefinitions } from "#veryfront/tool/remote-source-tools.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  collectDeclaredIntegrations,
  findUnconnectedIntegrationLines,
  unconnectedIntegrationLines,
} from "../../../../cli/commands/dev/unconnected-integrations.ts";

const config = { ai: { agents: { discovery: { paths: ["crew"] } } } };

describe("dev integration source discovery", () => {
  it("formats enabled tool warnings without replaceable array methods", () => {
    const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
    const join = Array.prototype.join;
    const slice = Array.prototype.slice;
    let lines: string[] | undefined;
    try {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        value: () => {
          throw new Error("project iterator");
        },
        configurable: true,
      });
      Array.prototype.join = () => {
        throw new Error("project join");
      };
      Array.prototype.slice = () => {
        throw new Error("project slice");
      };
      const declared = collectDeclaredIntegrations([
        { agentId: "b", tools: { salesforce__get_case: true } },
        { agentId: "a", tools: { salesforce__update_case: true, gmail__delete_email: false } },
      ]);
      lines = unconnectedIntegrationLines(declared, [], "case-demo");
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, iterator);
      Array.prototype.join = join;
      Array.prototype.slice = slice;
    }
    assertEquals(lines, [
      "Salesforce isn't connected. Agents a and b need it.",
      "  Connect: npx veryfront integration connect salesforce --project case-demo",
    ]);
  });
  it("ignores tools a source already materialized", async () => {
    // A local service-account source executes without a Veryfront connection, and a tool exists
    // only because its source listed it, so none of them can be a missing connection.
    const tools = createToolsFromRemoteDefinitions(
      {
        id: "salesforce-service-account",
        listTools: () => Promise.resolve([]),
        executeTool: () => Promise.resolve({}),
      },
      [{
        name: "salesforce__get_case",
        description: "Get a case",
        parameters: { type: "object", properties: {} },
      }],
    );

    assertEquals(
      collectDeclaredIntegrations([
        { agentId: "case-ingest", tools },
        { agentId: "case-dispose", tools: { salesforce__update_case: true } },
      ]),
      [{ integration: "salesforce", agentIds: ["case-dispose"] }],
    );
  });
  it("warns from custom-root agents and ignores stale default-root sources and disabled discovery", async () => {
    const env = {
      VERYFRONT_API_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "token",
      VERYFRONT_PROJECT_SLUG: "case-demo",
    };
    const previous = new Map(Object.keys(env).map((name) => [name, Deno.env.get(name)]));
    try {
      for (const [name, value] of Object.entries(env)) Deno.env.set(name, value);
      await withTempDir(async (dir) => {
        await Deno.mkdir(`${dir}/crew`);
        await Deno.mkdir(`${dir}/agents`);
        await Deno.writeTextFile(
          `${dir}/crew/crew-agent.ts`,
          `
          export default {
            id: "crew-agent",
            config: { id: "crew-agent", tools: { salesforce__get_case: true, gmail__delete_email: false } },
            generate() { return Promise.resolve({ text: "" }); },
          };
        `,
        );
        await Deno.writeTextFile(
          `${dir}/agents/stale-agent.ts`,
          `
          export default {
            id: "stale-agent",
            config: { id: "stale-agent", tools: { gmail__list_emails: true } },
            generate() { return Promise.resolve({ text: "" }); },
          };
        `,
        );
        const discovery = await discoverAll(createProjectDiscoveryConfig({
          projectDir: dir,
          config,
          allowHostProjectCodeExecution: true,
        }));
        assertEquals(discovery.errors, []);
        assertEquals([...discovery.agents.keys()], ["crew-agent"]);
        await withMockFetch(() => Promise.resolve(Response.json({ tools: [] })), async () => {
          assertEquals(await findUnconnectedIntegrationLines(dir, config), [
            "Salesforce isn't connected. Agent crew-agent needs it.",
            "  Connect: npx veryfront integration connect salesforce --project case-demo",
          ]);
          assertEquals(
            await findUnconnectedIntegrationLines(dir, {
              ...config,
              integrations: { allow: { gmail: {} } },
            }),
            [],
          );
          assertEquals(
            await findUnconnectedIntegrationLines(dir, {
              ...config,
              integrations: { allow: { salesforce: { allowedTools: ["update_case"] } } },
            }),
            [],
          );
          // The caller normalizes the policy before agents run; the check uses it as given.
          assertEquals(
            await findUnconnectedIntegrationLines(
              dir,
              config,
              normalizeSourceIntegrationPolicy({ allow: { gmail: {} } }),
            ),
            [],
          );
          assertEquals(
            await findUnconnectedIntegrationLines(dir, {
              ai: { agents: { discovery: { enabled: false, paths: ["crew"] } } },
            }),
            [],
          );
          assertEquals(
            await findUnconnectedIntegrationLines(dir, {
              ai: { agents: { discovery: { paths: [] } } },
            }),
            [],
          );
        });
      });
    } finally {
      agentRegistry.delete("crew-agent");
      agentRegistry.delete("stale-agent");
      for (const [name, value] of previous) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  });
});
