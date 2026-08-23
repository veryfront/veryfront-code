import "#veryfront/schemas/_test-setup.ts";
import type { AgentConfig } from "#veryfront/agent";
import { VeryfrontError } from "#veryfront/errors";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { loadRemoteToolsFromSource } from "#veryfront/tool";
import { connectors, icons } from "./_data.ts";
import {
  EXPERIMENTAL_INTEGRATIONS_ENV,
  filterVisibleIntegrations,
  HOST_ADAPTER_INTEGRATIONS_ENV,
} from "./feature-flags.ts";
import { HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV } from "./local-credential-host-policy.ts";
import {
  createLocalIntegrationToolSource,
  createSalesforceServiceAccountToolSource,
  getConnector,
  getConnectorNames,
  getIcon,
  listConnectors,
  SALESFORCE_SERVICE_ACCOUNT_ENV_VARS,
} from "./index.ts";

describe("integrations/index", () => {
  afterEach(() => {
    Deno.env.delete(EXPERIMENTAL_INTEGRATIONS_ENV);
    Deno.env.delete(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV);
  });

  it("exposes default-visible connector data through lookup helpers", () => {
    const visibleConnectors = filterVisibleIntegrations(connectors);

    assertEquals(listConnectors(), visibleConnectors);
    assertEquals(getConnectorNames(), visibleConnectors.map((connector) => connector.name));
    assertStrictEquals(
      getConnector("github"),
      connectors.find((connector) => connector.name === "github"),
    );
    assertEquals(getIcon("github"), icons.github);
  });

  it("hides feature-gated connectors by default", () => {
    assertEquals(getConnector("salesforce"), undefined);
    assertEquals(getIcon("salesforce"), undefined);
    assertEquals(getConnectorNames().includes("salesforce"), false);
  });

  it("shows eligible experimental connectors when explicitly enabled", () => {
    Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, "stripe");

    assertStrictEquals(
      getConnector("stripe"),
      connectors.find((connector) => connector.name === "stripe"),
    );
    assertEquals(getIcon("stripe"), icons.stripe);
    assertEquals(getConnectorNames().includes("stripe"), true);
  });

  it("keeps provider-adapter-only connectors unavailable when explicitly enabled", () => {
    Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, "salesforce");

    assertEquals(getConnector("salesforce"), undefined);
    assertEquals(getIcon("salesforce"), undefined);
    assertEquals(getConnectorNames().includes("salesforce"), false);
  });

  it("publishes an adapter-only connector the host declares it drives", () => {
    // This is the seam veryfront-api depends on: it ships its own Salesforce
    // client, so it needs the connector definitions to resolve tool names and
    // authorize calls. Without this the integration stays connectable but every
    // tool call fails to resolve.
    Deno.env.set(HOST_ADAPTER_INTEGRATIONS_ENV, "salesforce");
    try {
      assertEquals(getConnector("salesforce") !== undefined, true);
      assertEquals(getConnectorNames().includes("salesforce"), true);
      // Adapter-only and not declared by the host, so still absent.
      assertEquals(getConnector("pipedrive"), undefined);
    } finally {
      Deno.env.delete(HOST_ADAPTER_INTEGRATIONS_ENV);
    }
  });

  it("returns undefined for unknown connector lookups", () => {
    assertEquals(getConnector("missing-integration"), undefined);
    assertEquals(getIcon("missing-integration"), undefined);
  });

  it("exports the explicit local Salesforce service-account source", async () => {
    Deno.env.set(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV, "1");
    assertEquals(SALESFORCE_SERVICE_ACCOUNT_ENV_VARS, [
      "SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID",
      "SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET",
      "SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL",
    ]);
    const source = createSalesforceServiceAccountToolSource({
      allowedTools: ["salesforce__get_case"],
    });
    assertEquals(source.id, "salesforce-service-account");
    assertEquals((await source.listTools()).map((tool) => tool.name), [
      "salesforce__get_case",
    ]);

    const tools = await loadRemoteToolsFromSource(source);
    const config: AgentConfig = {
      system: "Read Salesforce cases.",
      tools,
    };
    assertStrictEquals(config.tools, tools);
    assertEquals(Object.keys(tools), ["salesforce__get_case"]);
  });

  it("keeps every exported local credential source behind the host grant", async () => {
    Deno.env.delete(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV);
    const sources = [
      createLocalIntegrationToolSource({
        tools: ["vercel__list_projects"],
        credentialProvider: () => "test-credential",
      }),
      createSalesforceServiceAccountToolSource({
        allowedTools: ["salesforce__get_case"],
      }),
    ];

    for (const source of sources) {
      const error = await assertRejects(() => source.listTools(), VeryfrontError);
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-config-invalid");
    }
  });
});
