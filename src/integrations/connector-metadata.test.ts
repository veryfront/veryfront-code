import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { connectors } from "./_data.ts";
import { SUPPORTED_INTEGRATION_NAMES } from "./feature-flags.ts";

function getConnector(name: string) {
  const connector = connectors.find((item) => item.name === name);
  assertExists(connector, `Expected connector ${name} to exist`);
  return connector;
}

// Default connectors that still publish no setup guide. Shrink this list as
// guides land; a new default connector must ship with one.
const DEFAULT_CONNECTORS_WITHOUT_SETUP_GUIDE = [
  "airtable",
  "asana",
  "calendar",
  "confluence",
  "figma",
  "github",
  "gitlab",
  "harvest",
  "hubspot",
  "jira",
  "linear",
  "notion",
  "onedrive",
  "outlook",
  "sentry",
  "sharepoint",
  "sheets",
  "slack",
  "teams",
];

describe("connector setup and side-effect metadata", () => {
  it("declares requiresWrite on every endpoint-backed tool", () => {
    const undeclared = connectors.flatMap((connector) =>
      connector.tools
        .filter((tool) => tool.endpoint && typeof tool.requiresWrite !== "boolean")
        .map((tool) => tool.id)
    );

    assertEquals(undeclared, []);
  });

  it("gives every default connector a category", () => {
    const uncategorized = SUPPORTED_INTEGRATION_NAMES.filter((name) =>
      !getConnector(name).category
    );

    assertEquals(uncategorized, []);
  });

  it("publishes a setup guide for every default connector outside the pending list", () => {
    const withoutGuide = SUPPORTED_INTEGRATION_NAMES.filter((name) =>
      !getConnector(name).setupGuide
    );

    assertEquals(withoutGuide, DEFAULT_CONNECTORS_WITHOUT_SETUP_GUIDE);
  });

  it("documents Gmail's OAuth app ownership, consent restrictions and a read-only check", () => {
    const guide = getConnector("gmail").setupGuide;
    assertExists(guide);
    const text = JSON.stringify(guide);

    assertStringIncludes(text, "GOOGLE_CLIENT_ID");
    assertStringIncludes(text, "https://api.veryfront.com/oauth/callback/gmail");
    assertStringIncludes(text, "/api/auth/gmail/callback");
    assertStringIncludes(text, "Testing");
    assertStringIncludes(text, "https://mail.google.com/");
    assertEquals(guide.steps.at(-1)?.title, "Verify access");
    assertStringIncludes(guide.steps.at(-1)?.description ?? "", "List Emails");
  });

  it("names the Salesforce service-account variables in the published guide", () => {
    const notes = getConnector("salesforce").setupGuide?.notes?.join("\n") ?? "";

    for (
      const name of [
        "SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID",
        "SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET",
        "SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL",
      ]
    ) {
      assertStringIncludes(notes, name);
    }
    assertStringIncludes(notes, "/docs/code/guides/integrations/salesforce#use-a-service-account");
  });

  it("does not require the Twilio sender number for the read tools", () => {
    const twilio = getConnector("twilio");
    const phoneNumber = twilio.envVars?.find((envVar) => envVar.name === "TWILIO_PHONE_NUMBER");

    assertEquals(phoneNumber?.required, false);
    assert(
      twilio.tools
        .filter((tool) => tool.endpoint)
        .every((tool) => !JSON.stringify(tool.endpoint).includes("TWILIO_PHONE_NUMBER")),
    );
  });

  it("pins the Neo4j read query to the Query API read access mode", () => {
    const neo4j = getConnector("neo4j");
    const readTool = neo4j.tools.find((tool) => tool.id === "neo4j__run_cypher_query");
    const writeTool = neo4j.tools.find((tool) => tool.id === "neo4j__run_cypher_write");

    assertEquals(readTool?.requiresWrite, false);
    assertEquals(readTool?.endpoint?.body?.accessMode?.default, "Read");
    assertEquals(readTool?.endpoint?.body?.accessMode?.fixed, true);
    assertEquals(writeTool?.requiresWrite, true);
    assertEquals(writeTool?.endpoint?.body?.accessMode, undefined);
    assert(!JSON.stringify(neo4j).includes("does not enforce read-only access"));
  });
});
