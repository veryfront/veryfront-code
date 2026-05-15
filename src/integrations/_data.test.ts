import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { connectors } from "./_data.ts";

function getConnector(name: string) {
  const connector = connectors.find((item) => item.name === name);
  assertExists(connector, `Expected connector ${name} to exist`);
  return connector;
}

function getTool(connectorName: string, toolId: string) {
  const connector = getConnector(connectorName);
  const tool = connector.tools.find((item) => item.id === toolId);
  assertExists(tool, `Expected ${connectorName}:${toolId} to exist`);
  return tool;
}

describe("integration endpoint specs", () => {
  it("adds endpoint specs for all 53 tools across the 5 targeted integrations", () => {
    const targetedConnectors = ["calendar", "github", "gmail", "linear", "slack"];
    let totalEndpointTools = 0;

    for (const connectorName of targetedConnectors) {
      const connector = getConnector(connectorName);
      const endpointTools = connector.tools.filter((tool) => tool.endpoint);

      assertEquals(
        endpointTools.length,
        connector.tools.length,
        `Expected every ${connectorName} tool to have an endpoint spec`,
      );

      totalEndpointTools += endpointTools.length;
    }

    assertEquals(totalEndpointTools, 53);
  });

  it("adds endpoint specs for the newly configured integration providers", () => {
    const expectedEndpointCounts = new Map([
      ["airtable", 5],
      ["discord", 2],
      ["figma", 4],
      ["notion", 4],
    ]);

    for (const [connectorName, expectedEndpointCount] of expectedEndpointCounts) {
      const connector = getConnector(connectorName);
      const endpointTools = connector.tools.filter((tool) => tool.endpoint);

      assertEquals(
        endpointTools.length,
        expectedEndpointCount,
        `Expected ${connectorName} to expose ${expectedEndpointCount} callable endpoint tools`,
      );
    }
  });

  it("adds static endpoint specs for the next configured integration providers", () => {
    const expectedEndpointCounts = new Map([
      ["hubspot", 5],
      ["dropbox", 4],
      ["drive", 4],
      ["docs-google", 4],
      ["sheets", 4],
      ["onedrive", 3],
      ["sharepoint", 4],
    ]);

    for (const [connectorName, expectedEndpointCount] of expectedEndpointCounts) {
      const connector = getConnector(connectorName);
      const endpointTools = connector.tools.filter((tool) => tool.endpoint);

      assertEquals(
        endpointTools.length,
        expectedEndpointCount,
        `Expected ${connectorName} to expose ${expectedEndpointCount} static endpoint tools`,
      );
    }
  });

  it("keeps newly added static endpoints executor-compatible", () => {
    const hubspotListContacts = getTool("hubspot", "list_contacts");
    assertEquals(
      hubspotListContacts.endpoint?.url,
      "https://api.hubapi.com/crm/v3/objects/contacts",
    );
    assertEquals(hubspotListContacts.endpoint?.response?.transform, "results");

    const hubspotCreateContact = getTool("hubspot", "create_contact");
    assertEquals(hubspotCreateContact.endpoint?.method, "POST");
    assertEquals(hubspotCreateContact.endpoint?.body?.properties?.required, true);

    const dropboxListFiles = getTool("dropbox", "list_files");
    assertEquals(dropboxListFiles.endpoint?.url, "https://api.dropboxapi.com/2/files/list_folder");
    assertEquals(dropboxListFiles.endpoint?.body?.path?.default, "");

    const driveCreateFolder = getTool("drive", "create_folder");
    assertEquals(driveCreateFolder.endpoint?.url, "https://www.googleapis.com/drive/v3/files");
    assertEquals(
      driveCreateFolder.endpoint?.body?.mimeType?.default,
      "application/vnd.google-apps.folder",
    );

    const docsCreateDocument = getTool("docs-google", "create_document");
    assertEquals(docsCreateDocument.endpoint?.url, "https://docs.googleapis.com/v1/documents");
    assertEquals(docsCreateDocument.endpoint?.body?.title?.required, true);

    const sheetsReadRange = getTool("sheets", "read_range");
    assertEquals(sheetsReadRange.endpoint?.params?.spreadsheetId?.in, "path");
    assertEquals(sheetsReadRange.endpoint?.params?.range?.in, "path");

    const oneDriveListFiles = getTool("onedrive", "list_files");
    assertEquals(
      oneDriveListFiles.endpoint?.url,
      "https://graph.microsoft.com/v1.0/me/drive/root/children",
    );
    assertEquals(oneDriveListFiles.endpoint?.params?.["$top"]?.default, 200);

    const sharepointListFiles = getTool("sharepoint", "list_files");
    assertEquals(
      sharepointListFiles.endpoint?.url,
      "https://graph.microsoft.com/v1.0/sites/{siteId}/drive/root/children",
    );
    assertEquals(sharepointListFiles.endpoint?.params?.siteId?.required, true);
  });

  it("keeps gmail connector tools aligned with scaffolded tool files", async () => {
    const gmail = getConnector("gmail");
    const toolFiles: string[] = [];

    for await (const entry of Deno.readDir("cli/templates/integrations/gmail/files/tools")) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        toolFiles.push(entry.name.replace(/\.ts$/, ""));
      }
    }

    const expectedFiles = gmail.tools.map((tool) => tool.id.replaceAll("_", "-")).sort();
    assertEquals(toolFiles.sort(), expectedFiles);
  });

  it("keeps github list-issues on GraphQL so pull requests stay separate", () => {
    const tool = getTool("github", "list_issues");

    assertEquals(tool.endpoint?.type, "graphql");
    assertEquals(tool.endpoint?.url, "https://api.github.com/graphql");
    assertEquals(tool.endpoint?.response?.transform, "repository.issues.nodes");
    assertStringIncludes(tool.endpoint?.query ?? "", "repository(owner: $owner, name: $repo)");
    assertStringIncludes(tool.endpoint?.query ?? "", "issues(first: $first, states: $states");
  });

  it("preserves executor-compatible defaults and GraphQL variable shapes", () => {
    const calendarListEvents = getTool("calendar", "list_events");
    assertEquals(calendarListEvents.endpoint?.params?.calendarId?.default, "primary");
    assertEquals(calendarListEvents.endpoint?.params?.orderBy?.default, "startTime");

    const gmailListEmails = getTool("gmail", "list_emails");
    assertEquals(gmailListEmails.endpoint?.params?.labelIds?.type, "string[]");

    const gmailGetEmail = getTool("gmail", "get_email");
    assertEquals(gmailGetEmail.endpoint?.params?.format?.default, "full");

    const linearSearchIssues = getTool("linear", "search_issues");
    assertStringIncludes(
      linearSearchIssues.endpoint?.query ?? "",
      "issueSearch(query: $query, first: $first)",
    );

    const linearCreateIssue = getTool("linear", "create_issue");
    assertStringIncludes(linearCreateIssue.endpoint?.query ?? "", "issueCreate(input: {");
    assertStringIncludes(linearCreateIssue.endpoint?.query ?? "", "teamId: $teamId");

    const linearUpdateIssue = getTool("linear", "update_issue");
    assertStringIncludes(linearUpdateIssue.endpoint?.query ?? "", "issueUpdate(id: $id, input: {");
    assertStringIncludes(linearUpdateIssue.endpoint?.query ?? "", "stateId: $stateId");
  });
});
