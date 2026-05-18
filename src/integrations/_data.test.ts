import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { airtableConfig } from "../oauth/providers/common.ts";
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
      ["airtable", 11],
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

  it("adds callable endpoint specs for remaining configured OAuth providers", () => {
    const expectedEndpointCounts = new Map([
      ["asana", 5],
      ["gitlab", 5],
      ["jira", 5],
      ["confluence", 5],
      ["salesforce", 5],
      ["outlook", 5],
      ["teams", 5],
      ["discord", 2],
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

  it("keeps remaining OAuth provider endpoints executor-compatible", () => {
    const asanaListTasks = getTool("asana", "list_tasks");
    assertEquals(asanaListTasks.endpoint?.url, "https://app.asana.com/api/1.0/tasks");
    assertEquals(asanaListTasks.endpoint?.params?.project?.in, "query");

    const gitlabGetIssue = getTool("gitlab", "get_issue");
    assertEquals(
      gitlabGetIssue.endpoint?.url,
      "https://gitlab.com/api/v4/projects/{projectId}/issues/{issueIid}",
    );
    assertEquals(gitlabGetIssue.endpoint?.params?.issueIid?.required, true);

    const jiraSearchIssues = getTool("jira", "search_issues");
    assertEquals(
      jiraSearchIssues.endpoint?.url,
      "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/search",
    );
    assertEquals(jiraSearchIssues.endpoint?.body?.jql?.required, true);

    const confluenceGetPage = getTool("confluence", "get_page");
    assertEquals(
      confluenceGetPage.endpoint?.url,
      "https://api.atlassian.com/ex/confluence/{cloudId}/wiki/rest/api/content/{pageId}",
    );
    assertEquals(confluenceGetPage.endpoint?.params?.expand?.default, "body.storage,version");

    const salesforceListAccounts = getTool("salesforce", "list_accounts");
    assertEquals(
      salesforceListAccounts.endpoint?.url,
      "{{oauth.raw.instance_url}}/services/data/v61.0/query",
    );
    assertStringIncludes(salesforceListAccounts.endpoint?.params?.q?.default as string, "Account");

    const outlookSendEmail = getTool("outlook", "send_email");
    assertEquals(outlookSendEmail.endpoint?.url, "https://graph.microsoft.com/v1.0/me/sendMail");
    assertEquals(outlookSendEmail.endpoint?.body?.message?.required, true);

    const teamsListChannels = getTool("teams", "list_channels");
    assertEquals(
      teamsListChannels.endpoint?.url,
      "https://graph.microsoft.com/v1.0/teams/{teamId}/channels",
    );
    assertEquals(teamsListChannels.endpoint?.params?.teamId?.required, true);
    const teams = getConnector("teams");
    assertEquals(teams.auth.scopes?.includes("Channel.ReadBasic.All"), true);

    const confluence = getConnector("confluence");
    assertEquals(confluence.auth.additionalAuthParams?.audience, "api.atlassian.com");
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

  it("keeps endpoint path params aligned with URL placeholders", () => {
    const oauthMetadataTemplate = /{{\s*oauth\.raw\.[A-Za-z0-9_.-]+\s*}}/g;

    for (const connector of connectors) {
      for (const tool of connector.tools) {
        const endpoint = tool.endpoint;
        if (!endpoint) continue;

        const urlWithoutOAuthTemplates = endpoint.url.replace(
          oauthMetadataTemplate,
          "https://oauth.example",
        );
        const pathParams = Object.entries(endpoint.params ?? {}).filter(([, param]) =>
          param.in === "path"
        );

        for (const [paramName] of pathParams) {
          assertStringIncludes(
            urlWithoutOAuthTemplates,
            `{${paramName}}`,
            `${connector.name}:${
              tool.id ?? tool.name
            } declares path param ${paramName} but URL does not contain it`,
          );
        }

        for (const placeholder of urlWithoutOAuthTemplates.matchAll(/{([A-Za-z0-9_$.-]+)}/g)) {
          const placeholderName = placeholder[1]!;
          assertExists(
            endpoint.params?.[placeholderName],
            `${connector.name}:${
              tool.id ?? tool.name
            } URL placeholder ${placeholderName} is missing a param definition`,
          );
          assertEquals(
            endpoint.params?.[placeholderName]?.in,
            "path",
            `${connector.name}:${
              tool.id ?? tool.name
            } URL placeholder ${placeholderName} must be a path param`,
          );
        }
      }
    }
  });

  it("exposes Airtable CRUD and schema mutation endpoint tools", () => {
    const airtable = getConnector("airtable");
    const toolIds = airtable.tools.map((tool) => tool.id);

    assertEquals(toolIds, [
      "list_bases",
      "get_base",
      "list_records",
      "get_record",
      "create_record",
      "create_records",
      "update_record",
      "delete_record",
      "create_table",
      "update_table",
      "create_field",
    ]);

    for (const tool of airtable.tools) {
      assertExists(tool.endpoint, `Expected airtable:${tool.id} to have an endpoint spec`);
    }

    assertEquals(getTool("airtable", "update_record").endpoint?.method, "PATCH");
    assertEquals(getTool("airtable", "delete_record").endpoint?.method, "DELETE");
    assertEquals(getTool("airtable", "create_records").endpoint?.response?.transform, "records");
    assertEquals(
      getTool("airtable", "create_table").endpoint?.url,
      "https://api.airtable.com/v0/meta/bases/{baseId}/tables",
    );
    assertEquals(
      getTool("airtable", "update_table").endpoint?.url,
      "https://api.airtable.com/v0/meta/bases/{baseId}/tables/{tableId}",
    );
    assertEquals(
      getTool("airtable", "create_field").endpoint?.url,
      "https://api.airtable.com/v0/meta/bases/{baseId}/tables/{tableId}/fields",
    );
  });

  it("keeps Airtable OAuth runtime scopes aligned with schema mutation tools", () => {
    const airtable = getConnector("airtable");

    assertEquals(airtable.auth?.scopes, airtableConfig.defaultScopes);
    assertStringIncludes(airtableConfig.defaultScopes.join(" "), "schema.bases:write");
  });

  it("keeps Airtable connector tools aligned with scaffolded tool files", async () => {
    const airtable = getConnector("airtable");
    const toolFiles: string[] = [];

    for await (const entry of Deno.readDir("cli/templates/integrations/airtable/files/tools")) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        toolFiles.push(entry.name.replace(/\.ts$/, ""));
      }
    }

    const expectedFiles = airtable.tools.map((tool) => tool.id?.replaceAll("_", "-")).sort();
    assertEquals(toolFiles.sort(), expectedFiles);
  });

  it("documents Airtable batch and schema size constraints for agents", async () => {
    const createRecords = getTool("airtable", "create_records");
    const createTable = getTool("airtable", "create_table");
    const createRecordsTool = await Deno.readTextFile(
      "cli/templates/integrations/airtable/files/tools/create-records.ts",
    );
    const createTableTool = await Deno.readTextFile(
      "cli/templates/integrations/airtable/files/tools/create-table.ts",
    );

    assertStringIncludes(
      createRecords.endpoint?.body?.records?.description ?? "",
      "1-10",
    );
    assertStringIncludes(
      createTable.endpoint?.body?.fields?.description ?? "",
      "At least one",
    );
    assertStringIncludes(createRecordsTool, ".min(1)");
    assertStringIncludes(createRecordsTool, ".max(10)");
    assertStringIncludes(createTableTool, ".min(1)");
  });

  it("keeps gmail connector tools aligned with scaffolded tool files", async () => {
    const gmail = getConnector("gmail");
    const toolFiles: string[] = [];

    for await (const entry of Deno.readDir("cli/templates/integrations/gmail/files/tools")) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        toolFiles.push(entry.name.replace(/\.ts$/, ""));
      }
    }

    const expectedFiles = gmail.tools.map((tool) => {
      assertExists(tool.id);
      return tool.id.replaceAll("_", "-");
    }).sort();
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
