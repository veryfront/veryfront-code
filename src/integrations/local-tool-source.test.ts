import "#veryfront/schemas/_test-setup.ts";
import {
  _resetEnvironmentConfig,
  _setEnvironmentConfigForTesting,
} from "#veryfront/config/environment-config.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createLocalIntegrationToolSource } from "./index.ts";

const TEST_CREDENTIAL = "LOCAL_INTEGRATION_SECRET_MUST_NOT_LEAK";
const testCredentialProvider = () => TEST_CREDENTIAL;

async function assertConfigurationError(
  createPromise: () => Promise<unknown>,
  expectedDetail: string,
): Promise<void> {
  const error = await assertRejects(createPromise, VeryfrontError);
  assertEquals(error.slug, "local-integration-config-invalid");
  assert(error.message.includes(expectedDetail), error.message);
  assertEquals(error.message.includes(TEST_CREDENTIAL), false);
}

describe("createLocalIntegrationToolSource", () => {
  afterEach(() => _resetEnvironmentConfig());

  it("lists only explicitly granted catalog tools with credential-free metadata", async () => {
    const source = createLocalIntegrationToolSource({
      tools: ["vercel__get_project", "vercel__list_projects"],
      credentialProvider: testCredentialProvider,
    });

    const definitions = await source.listTools();

    assertEquals(source.id, "veryfront-local-integrations");
    assertEquals(definitions.map((definition) => definition.name), [
      "vercel__get_project",
      "vercel__list_projects",
    ]);
    assertEquals(definitions[0]?.parameters, {
      type: "object",
      properties: {
        idOrName: {
          type: "string",
          description: "Project ID (prj_...) or project name",
        },
        teamId: {
          type: "string",
          description: "Team ID to perform the request on behalf of",
        },
        slug: {
          type: "string",
          description: "Team slug, alternative to teamId",
        },
      },
      required: ["idOrName"],
      additionalProperties: false,
    });

    const serialized = JSON.stringify(definitions);
    assertEquals(serialized.includes("VERCEL_TOKEN"), false);
    assertEquals(serialized.includes(TEST_CREDENTIAL), false);
  });

  it("snapshots its allowlist before caller mutation", async () => {
    const tools = ["vercel__list_projects"];
    const source = createLocalIntegrationToolSource({
      tools,
      credentialProvider: testCredentialProvider,
    });

    tools.push("vercel__get_project");

    assertEquals((await source.listTools()).map((definition) => definition.name), [
      "vercel__list_projects",
    ]);
  });

  it("fails closed for malformed, unknown, duplicate, and unsupported tools", async () => {
    const fixtures = [
      { tool: "vercel", detail: "canonical" },
      { tool: "vercel__missing", detail: "unknown" },
      { tool: "aws__list-s3-buckets", detail: "endpoint" },
      { tool: "github__list_issues", detail: "GraphQL" },
      { tool: "gmail__list_emails", detail: "enrichment" },
      { tool: "alphavantage__quote", detail: "query" },
      { tool: "slack__list_channels", detail: "authorization-code" },
    ] as const;

    for (const fixture of fixtures) {
      await assertConfigurationError(async () => {
        const source = createLocalIntegrationToolSource({
          tools: [fixture.tool],
          credentialProvider: testCredentialProvider,
        });
        await source.listTools();
      }, fixture.detail);
    }

    await assertConfigurationError(async () => {
      const duplicateSource = createLocalIntegrationToolSource({
        tools: ["vercel__list_projects", "vercel__list_projects"],
        credentialProvider: testCredentialProvider,
      });
      await duplicateSource.listTools();
    }, "duplicate");
  });

  it("rejects local credential execution in hosted and proxy runtimes", async () => {
    for (
      const environment of [
        { veryfrontMode: "hosted", proxyMode: false },
        { veryfrontMode: "production", proxyMode: true },
      ]
    ) {
      _setEnvironmentConfigForTesting(environment);
      const source = createLocalIntegrationToolSource({
        tools: ["vercel__list_projects"],
        credentialProvider: testCredentialProvider,
      });

      await assertConfigurationError(() => source.listTools(), "local or self-hosted");
      _resetEnvironmentConfig();
    }
  });

  it("never executes a catalog tool outside its exact source grant", async () => {
    const source = createLocalIntegrationToolSource({
      tools: ["vercel__list_projects"],
      credentialProvider: testCredentialProvider,
    });

    await assertConfigurationError(
      () => source.executeTool("vercel__get_project", { idOrName: "demo" }),
      "not granted",
    );
  });
});
