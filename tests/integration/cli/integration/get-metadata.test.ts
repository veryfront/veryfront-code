import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createIntegrationClient } from "#veryfront/integrations/client.ts";
import { runIntegrationOperation } from "#cli/commands/integration/command";

// veryfront-api pins the REST detail with a golden and checks GraphQL and MCP
// against it. `veryfront integration get` is the CLI projection of the same
// detail, so it must print every setup field exactly as REST returns it.

const project = { id: "11111111-1111-4111-8111-111111111111", slug: "test-project" };

const restDetail = {
  name: "example",
  display_name: "Example",
  icon: "example.svg",
  description: "Synthetic connector",
  category: "communication",
  availability: "default",
  auth: { type: "basic", provider: null },
  credential_env_var_names: ["EXAMPLE_ACCOUNT_ID", "EXAMPLE_TOKEN"],
  credential_requirement: {
    mode: "project_credentials",
    managed_oauth: false,
    byo_oauth_app_override: {
      supported: false,
      required: false,
      client_id_env_var: null,
      client_secret_env_var: null,
    },
    mandatory_env_vars: ["EXAMPLE_ACCOUNT_ID", "EXAMPLE_TOKEN"],
  },
  env_vars: [
    {
      name: "EXAMPLE_ACCOUNT_ID",
      description: "Account id",
      required: true,
      sensitive: false,
      docs_url: "https://example.test/docs/account",
    },
    { name: "EXAMPLE_TOKEN", description: "Token", required: true, sensitive: true },
    {
      name: "EXAMPLE_SENDER",
      description: "Optional sender",
      required: false,
      sensitive: false,
      default: "+10000000000",
    },
  ],
  tools: [
    { id: "example__list_messages", name: "List", description: "Read", requires_write: false },
    { id: "example__send_message", name: "Send", description: "Write", requires_write: true },
  ],
  setup_guide: {
    title: "Set up Example",
    steps: [{ step: 1, title: "Create a token", description: "Open settings", url: null }],
    notes: ["Use a read-only token for reads."],
    documentation: "https://example.test/docs",
  },
  project_connections: { connected: 0, expired: 0, disconnected: 0 },
  project_user_connections: { connected: 0, expired: 0, disconnected: 0 },
};

describe("veryfront integration get", () => {
  it("prints the REST detail with its setup metadata unchanged", async () => {
    const requested: string[] = [];
    const output = await withMockFetch((input) => {
      const url = new URL(String(input));
      requested.push(url.pathname);
      if (url.pathname === "/v1/projects/test-project") {
        return Promise.resolve(Response.json(project));
      }
      if (url.pathname === "/v1/integrations/tools/list") {
        // The client's read-only project binding probe.
        return Promise.resolve(
          Response.json({ tools: [] }, { headers: { "x-veryfront-project-id": project.id } }),
        );
      }
      return Promise.resolve(Response.json(restDetail));
    }, async () => {
      const client = await createIntegrationClient({
        apiBaseUrl: "https://api.example.test/v1",
        authToken: "synthetic-client-token",
        projectReference: project.slug,
      });
      return await runIntegrationOperation({
        subcommand: "get",
        target: "example",
        scope: "user",
        noBrowser: false,
        timeout: 300,
      }, client);
    });

    assertEquals(output, restDetail);
    assertEquals(requested.at(-1), "/v1/integrations/example");
  });
});
