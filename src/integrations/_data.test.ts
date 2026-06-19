import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { airtableConfig } from "../oauth/providers/common.ts";
import { connectors, icons } from "./_data.ts";
import { historicalToolSummaries } from "./_tool_summaries.ts";
import { filterVisibleIntegrations } from "./feature-flags.ts";

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
  it("keeps all source connectors while showing only the supported end-user surface by default", () => {
    const supportedConnectors = [
      "airtable",
      "asana",
      "calendar",
      "confluence",
      "docs-google",
      "drive",
      "figma",
      "github",
      "gitlab",
      "gmail",
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
    const sourceConnectors = [
      "activecampaign",
      "adyen",
      "airtable",
      "algolia",
      "alphavantage",
      "amplitude",
      "anthropic",
      "apify",
      "apollo",
      "asana",
      "ashby",
      "assemblyai",
      "attio",
      "aws",
      "axiom",
      "azure",
      "azure-blob-storage",
      "azure-document-intelligence",
      "bamboohr",
      "basecamp",
      "betterstack",
      "bigcommerce",
      "billbee",
      "bitbucket",
      "box",
      "brave-search",
      "brevo",
      "browserbase",
      "buildkite",
      "cal-com",
      "calendar",
      "calendly",
      "chargebee",
      "checkly",
      "circleci",
      "cleverreach",
      "clickhouse",
      "clickup",
      "close",
      "cloudflare",
      "coda",
      "cohere",
      "confluence",
      "customer-io",
      "databricks",
      "datadog",
      "datev",
      "daytona",
      "deel",
      "deepgram",
      "dialpad",
      "digitalocean",
      "discord",
      "docs-google",
      "docusign",
      "drive",
      "e2b",
      "elevenlabs",
      "exa",
      "factorial",
      "fal",
      "fathom",
      "figma",
      "finapi",
      "firecrawl",
      "fireflies",
      "fireworks-ai",
      "fly-io",
      "folk",
      "freshdesk",
      "front",
      "gcp",
      "gemini",
      "github",
      "gitlab",
      "gmail",
      "gocardless",
      "gong",
      "google-analytics",
      "google-bigquery",
      "google-chat",
      "google-cloud-storage",
      "google-contacts",
      "google-forms",
      "gorgias",
      "grafana-cloud",
      "greenhouse",
      "groq",
      "guru",
      "gusto",
      "harvest",
      "help-scout",
      "heroku",
      "hetzner",
      "hubspot",
      "huggingface",
      "intercom",
      "ionos",
      "jira",
      "jotform",
      "klarna",
      "klaviyo",
      "langfuse",
      "langsmith",
      "launchdarkly",
      "lever",
      "lexoffice",
      "linear",
      "mailchimp",
      "metabase",
      "mindee",
      "mistral",
      "mixpanel",
      "mollie",
      "monday",
      "mongodb-atlas",
      "moss",
      "neo4j",
      "neon",
      "netlify",
      "new-relic",
      "north-data",
      "notion",
      "onedrive",
      "openai",
      "openrouter",
      "outlook",
      "paddle",
      "pagerduty",
      "pandadoc",
      "paypal",
      "perplexity",
      "persona",
      "personio",
      "pinecone",
      "pipedrive",
      "planetscale",
      "polygon",
      "portkey",
      "posthog",
      "power-bi",
      "productboard",
      "qdrant",
      "qonto",
      "quickbooks",
      "railway",
      "ramp",
      "razorpay",
      "redis-cloud",
      "render",
      "replicate",
      "resend",
      "rippling",
      "salesflare",
      "salesforce",
      "sap",
      "segment",
      "sendcloud",
      "sendgrid",
      "sentry",
      "serpapi",
      "servicenow",
      "sevdesk",
      "sharepoint",
      "sheets",
      "shopify",
      "shopware",
      "shortcut",
      "skribble",
      "slack",
      "snowflake",
      "snyk",
      "sprites",
      "square",
      "stability-ai",
      "stackit",
      "stripe",
      "supabase",
      "surveymonkey",
      "tally",
      "tavily",
      "teams",
      "telegram",
      "todoist",
      "together-ai",
      "trello",
      "trusted-shops",
      "twilio",
      "typeform",
      "unstructured",
      "unzer",
      "vercel",
      "voyage-ai",
      "weaviate",
      "webex",
      "whatsapp",
      "wix",
      "woocommerce",
      "workable",
      "xentral",
      "xero",
      "zendesk",
      "zoho-crm",
      "zoom",
    ];

    assertEquals(connectors.map((item) => item.name), sourceConnectors);
    assertEquals(
      filterVisibleIntegrations(connectors).map((item) => item.name),
      supportedConnectors,
    );

    for (const connector of filterVisibleIntegrations(connectors)) {
      assertEquals(
        connector.tools.every((tool) => Boolean(tool.endpoint)),
        true,
        `Expected every ${connector.name} tool to be endpoint-backed`,
      );
    }
  });

  it("registers the experimental wave-1 connectors behind the experimental flag", () => {
    const waveConnectors = [
      "openai",
      "todoist",
      "calendly",
      "google-analytics",
      "klaviyo",
      "datadog",
      "paypal",
    ];

    for (const name of waveConnectors) {
      const connector = getConnector(name);
      assertEquals(
        connector.tools.every((tool) => Boolean(tool.endpoint)),
        true,
        `Expected every ${name} tool to be endpoint-backed`,
      );
      assertStringIncludes(icons[name] ?? "", "<svg");
    }

    const openai = getConnector("openai");
    assertEquals(openai.auth.type, "api-key");
    assertEquals(openai.auth.keyName, "OPENAI_API_KEY");
    assertEquals(openai.auth.headerPrefix, "Bearer");

    const todoist = getConnector("todoist");
    assertEquals(todoist.auth.provider, "todoist");
    assertEquals(todoist.auth.tokenUrl, "https://api.todoist.com/oauth/access_token");

    const calendly = getConnector("calendly");
    assertEquals(calendly.auth.provider, "calendly");
    assertEquals(calendly.auth.authorizationUrl, "https://auth.calendly.com/oauth/authorize");

    const googleAnalytics = getConnector("google-analytics");
    assertEquals(googleAnalytics.auth.provider, "google");
    assertEquals(
      googleAnalytics.auth.scopes,
      ["https://www.googleapis.com/auth/analytics.readonly"],
    );
    assertEquals(
      googleAnalytics.tools.every((tool) => tool.requiresWrite === false),
      true,
      "Expected google-analytics to be read-only",
    );

    const klaviyo = getConnector("klaviyo");
    assertEquals(klaviyo.auth.type, "api-key");
    assertEquals(klaviyo.auth.keyName, "KLAVIYO_API_KEY");
    assertEquals(klaviyo.auth.headerPrefix, "Klaviyo-API-Key");

    const datadog = getConnector("datadog");
    assertEquals(datadog.auth.type, "api-key");
    assertEquals(datadog.auth.headerName, "DD-API-KEY");
    assertEquals(datadog.auth.additionalHeaders, { "DD-APPLICATION-KEY": "DD_APP_KEY" });

    const paypal = getConnector("paypal");
    assertEquals(paypal.auth.type, "oauth2");
    assertEquals(paypal.auth.grantType, "client_credentials");
    assertEquals(paypal.auth.tokenUrl, "https://api-m.paypal.com/v1/oauth2/token");
    assertEquals(paypal.auth.authorizationUrl, undefined);
  });

  it("publishes generic record tools via body passthrough", () => {
    const salesforceCreate = getTool("salesforce", "create_record");
    assertEquals(salesforceCreate.requiresWrite, true);
    assertEquals(salesforceCreate.endpoint?.bodyMode, "passthrough");
    assertEquals(salesforceCreate.endpoint?.body?.record?.required, true);
    assertEquals(
      getTool("salesforce", "delete_record").endpoint?.method,
      "DELETE",
    );

    const servicenowQuery = getTool("servicenow", "query_table");
    assertEquals(servicenowQuery.requiresWrite, false);
    assertEquals(
      servicenowQuery.endpoint?.url,
      "https://{instanceHost}/api/now/v1/table/{tableName}",
    );
    assertEquals(
      getTool("servicenow", "create_table_record").endpoint?.bodyMode,
      "passthrough",
    );
  });

  it("uploads DATEV documents as a multipart form-data request with a binary file part", () => {
    const upload = getTool("datev", "upload_document");
    assertEquals(upload.requiresWrite, true);
    assertEquals(upload.endpoint?.method, "POST");
    // multipart/form-data needs bodyMode "form-data" so the executor builds a
    // real multipart body (boundary + parts); contentType alone left the body
    // JSON-encoded with a boundary-less header, which DATEV (and any multipart
    // parser) rejects.
    assertEquals(upload.endpoint?.bodyMode, "form-data");
    assertEquals(upload.endpoint?.contentType, "multipart/form-data");
    assertEquals(upload.endpoint?.body?.file?.required, true);
    assertEquals(upload.endpoint?.body?.file?.encoding, "base64");
    assertEquals(upload.endpoint?.body?.file?.partFilenameField, "file_name");
    assertEquals(upload.endpoint?.body?.file_name?.required, true);
  });

  it("registers discord only now that it ships an endpoint-backed tool surface", () => {
    const connectorNames = connectors.map((item) => item.name as string);

    assertEquals(connectorNames.includes("discord"), true);
    assertEquals(connectorNames.includes("hubspot"), true);

    const discord = getConnector("discord");
    assertEquals(discord.tools.length > 0, true);
    assertEquals(
      discord.tools.every((tool) => Boolean(tool.endpoint)),
      true,
      "Expected every discord tool to be endpoint-backed",
    );
  });

  it("publishes HubSpot lead and form submission endpoint tools", () => {
    const hubspot = getConnector("hubspot");
    const toolIds = hubspot.tools.map((tool) => tool.id);

    assertEquals(hubspot.auth.provider, "hubspot");
    assertEquals(hubspot.auth.scopes?.includes("oauth"), true);
    assertEquals(hubspot.auth.scopes?.includes("crm.objects.contacts.read"), true);
    assertEquals(hubspot.auth.scopes?.includes("crm.objects.contacts.write"), false);
    assertEquals(hubspot.auth.scopes?.includes("crm.objects.leads.read"), false);
    assertEquals(hubspot.auth.scopes?.includes("crm.objects.leads.write"), false);
    assertEquals(hubspot.auth.optionalScopes?.includes("crm.objects.leads.read"), true);
    assertEquals(hubspot.auth.optionalScopes?.includes("crm.objects.leads.write"), true);
    assertEquals(hubspot.auth.scopes?.includes("crm.objects.companies.read"), false);
    assertEquals(hubspot.auth.scopes?.includes("crm.objects.companies.write"), false);
    assertEquals(hubspot.auth.scopes?.includes("crm.schemas.contacts.read"), false);
    assertEquals(hubspot.auth.scopes?.includes("crm.schemas.companies.read"), false);
    assertEquals(hubspot.auth.scopes?.includes("crm.schemas.leads.read"), false);
    assertEquals(hubspot.auth.scopes?.includes("crm.objects.owners.read"), false);
    assertEquals(hubspot.auth.scopes?.includes("forms"), false);
    assertEquals(hubspot.auth.optionalScopes?.includes("forms"), true);
    assertEquals(toolIds.includes("get_contact"), true);
    assertEquals(toolIds.includes("list_form_submissions"), true);
    assertEquals(toolIds.includes("search_contacts"), true);
    assertEquals(toolIds.includes("create_contact"), true);
    assertEquals(toolIds.includes("update_contact"), true);
    assertEquals(toolIds.includes("get_lead"), true);
    assertEquals(toolIds.includes("list_leads"), true);
    assertEquals(toolIds.includes("search_leads"), true);
    assertEquals(toolIds.includes("create_lead"), true);
    assertEquals(toolIds.includes("update_lead"), true);
    assertEquals(toolIds.includes("get_company"), true);
    assertEquals(toolIds.includes("search_companies"), true);
    assertEquals(toolIds.includes("create_company"), true);
    assertEquals(toolIds.includes("update_company"), true);
    assertEquals(toolIds.includes("list_properties"), true);
    assertEquals(toolIds.includes("list_owners"), true);
    assertEquals(toolIds.includes("list_association_labels"), true);
    assertEquals(toolIds.includes("list_associations"), true);
    assertEquals(toolIds.includes("associate_records"), true);
    assertEquals(toolIds.includes("remove_association"), true);
    assertEquals(
      hubspot.tools.every((tool) => Boolean(tool.endpoint)),
      true,
      "Expected every HubSpot tool to have an endpoint spec",
    );
  });

  it("adds endpoint specs for all 70 tools across the 5 targeted integrations", () => {
    const targetedConnectors = [
      "calendar",
      "github",
      "gmail",
      "linear",
      "slack",
    ];
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

    assertEquals(totalEndpointTools, 73);
  });

  it("adds endpoint specs for the newly configured integration providers", () => {
    const expectedEndpointCounts = new Map([
      ["airtable", 11],
      ["figma", 4],
      ["notion", 10],
    ]);

    for (
      const [connectorName, expectedEndpointCount] of expectedEndpointCounts
    ) {
      const connector = getConnector(connectorName);
      const endpointTools = connector.tools.filter((tool) => tool.endpoint);

      assertEquals(
        endpointTools.length,
        expectedEndpointCount,
        `Expected ${connectorName} to expose ${expectedEndpointCount} callable endpoint tools`,
      );
    }
  });

  it("uses the documented SAP supplier invoice release function import", () => {
    const tool = getTool("sap", "release_supplier_invoice");

    assertEquals(tool.requiresWrite, true);
    assertEquals(tool.endpoint?.method, "POST");
    assertEquals(
      tool.endpoint?.url,
      "https://{sapHost}/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/Release",
    );
    assertEquals(tool.endpoint?.params?.SupplierInvoice?.in, "query");
    assertEquals(tool.endpoint?.params?.SupplierInvoice?.required, true);
    assertEquals(tool.endpoint?.params?.FiscalYear?.in, "query");
    assertEquals(tool.endpoint?.params?.FiscalYear?.required, true);
    assertEquals(tool.endpoint?.params?.DiscountDaysHaveToBeShifted?.in, "query");
    assertEquals(tool.endpoint?.params?.DiscountDaysHaveToBeShifted?.type, "boolean");
  });

  it("embeds icons for the operations integration providers", () => {
    assertStringIncludes(icons.sap ?? "", "<svg");
    assertStringIncludes(icons.persona ?? "", "<svg");
    assertStringIncludes(icons.servicenow ?? "", "<svg");
    assertStringIncludes(icons.zendesk ?? "", "<svg");
  });

  it("adds a GitHub user lookup tool", () => {
    const tool = getTool("github", "get_user");

    assertEquals(tool.requiresWrite, false);
    assertEquals(tool.endpoint?.method, "GET");
    assertEquals(tool.endpoint?.url, "https://api.github.com/users/{username}");
    assertEquals(tool.endpoint?.params?.username?.required, true);
  });

  it("requests only the Figma scopes needed by the exposed profile, file, and comment tools", () => {
    const figma = getConnector("figma");
    assertEquals(figma.auth.scopes?.includes("current_user:read"), true);
    assertEquals(figma.auth.scopes?.includes("file_content:read"), true);
    assertEquals(figma.auth.scopes?.includes("file_comments:read"), true);
    assertEquals(figma.auth.scopes?.includes("file_comments:write"), true);
    assertEquals(figma.auth.scopes?.includes("project_metadata:read"), false);
    assertEquals(figma.auth.scopes?.includes("projects:read"), false);
  });

  it("does not expose unsupported Figma project listing tools for public OAuth apps", () => {
    const figma = getConnector("figma");
    assertEquals(figma.tools.some((tool) => tool.id === "list_projects"), false);
    assertEquals(figma.tools.some((tool) => tool.id === "list_files"), false);

    const getFile = getTool("figma", "get_file");
    assertStringIncludes(getFile.description, "pages");
  });

  it("adds static endpoint specs for the next configured integration providers", () => {
    const expectedEndpointCounts = new Map([
      ["drive", 9],
      ["docs-google", 5],
      ["sheets", 16],
      ["onedrive", 7],
      ["sharepoint", 7],
    ]);

    for (
      const [connectorName, expectedEndpointCount] of expectedEndpointCounts
    ) {
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
      ["asana", 12],
      ["gitlab", 10],
      ["jira", 12],
      ["confluence", 7],
      ["outlook", 61],
      ["teams", 7],
    ]);

    for (
      const [connectorName, expectedEndpointCount] of expectedEndpointCounts
    ) {
      const connector = getConnector(connectorName);
      const endpointTools = connector.tools.filter((tool) => tool.endpoint);

      assertEquals(
        endpointTools.length,
        expectedEndpointCount,
        `Expected ${connectorName} to expose ${expectedEndpointCount} callable endpoint tools`,
      );
    }
  });

  it("adds callable endpoint specs for the Sentry OAuth provider", () => {
    const sentry = getConnector("sentry");
    const endpointTools = sentry.tools.filter((tool) => tool.endpoint);

    assertEquals(sentry.auth.type, "oauth2");
    assertEquals(sentry.auth.provider, "sentry");
    assertEquals(sentry.auth.tokenAuthMethod, "none");
    assertEquals(sentry.auth.pkce, true);
    assertEquals(
      sentry.envVars?.map((envVar) => envVar.name).includes("SENTRY_CLIENT_SECRET"),
      false,
    );
    assertEquals(
      endpointTools.map((tool) => tool.id).sort(),
      [
        "get_issue",
        "get_latest_event",
        "list_issues",
        "list_organizations",
        "list_projects",
        "resolve_issue",
      ],
    );

    const listOrganizations = getTool("sentry", "list_organizations");
    assertEquals(
      listOrganizations.endpoint?.url,
      "https://sentry.io/api/0/organizations/",
    );
    assertEquals(listOrganizations.endpoint?.params?.owner?.in, "query");

    const listProjects = getTool("sentry", "list_projects");
    assertEquals(
      listProjects.endpoint?.url,
      "https://sentry.io/api/0/organizations/{organizationSlug}/projects/",
    );
    assertEquals(listProjects.endpoint?.params?.organizationSlug?.required, true);

    const listIssues = getTool("sentry", "list_issues");
    assertEquals(
      listIssues.endpoint?.url,
      "https://sentry.io/api/0/projects/{organizationSlug}/{projectSlug}/issues/",
    );
    assertEquals(listIssues.endpoint?.params?.projectSlug?.required, true);

    const getIssue = getTool("sentry", "get_issue");
    assertEquals(
      getIssue.endpoint?.url,
      "https://sentry.io/api/0/organizations/{organizationSlug}/issues/{issueId}/",
    );

    const resolveIssue = getTool("sentry", "resolve_issue");
    assertEquals(resolveIssue.endpoint?.method, "PUT");
    assertEquals(resolveIssue.endpoint?.body?.status?.default, "resolved");
  });

  it("keeps remaining OAuth provider endpoints executor-compatible", () => {
    const asanaListTasks = getTool("asana", "list_tasks");
    assertEquals(
      asanaListTasks.endpoint?.url,
      "https://app.asana.com/api/1.0/tasks",
    );
    assertEquals(asanaListTasks.endpoint?.params?.project?.in, "query");

    const asanaDeleteTask = getTool("asana", "delete_task");
    assertEquals(asanaDeleteTask.endpoint?.method, "DELETE");
    assertEquals(
      asanaDeleteTask.endpoint?.url,
      "https://app.asana.com/api/1.0/tasks/{taskGid}",
    );
    assertEquals(asanaDeleteTask.endpoint?.params?.taskGid?.required, true);

    const asanaListWorkspaces = getTool("asana", "list_workspaces");
    assertEquals(
      asanaListWorkspaces.endpoint?.url,
      "https://app.asana.com/api/1.0/workspaces",
    );

    const asanaListUsers = getTool("asana", "list_users");
    assertEquals(asanaListUsers.endpoint?.params?.workspace?.required, true);

    const asanaListTeams = getTool("asana", "list_teams");
    assertEquals(
      asanaListTeams.endpoint?.url,
      "https://app.asana.com/api/1.0/workspaces/{workspaceGid}/teams",
    );
    assertEquals(asanaListTeams.endpoint?.params?.workspaceGid?.required, true);

    const asanaAddTaskComment = getTool("asana", "add_task_comment");
    assertEquals(asanaAddTaskComment.endpoint?.method, "POST");
    assertEquals(asanaAddTaskComment.endpoint?.body?.data?.required, true);

    const asanaListTaskComments = getTool("asana", "list_task_comments");
    assertEquals(
      asanaListTaskComments.endpoint?.url,
      "https://app.asana.com/api/1.0/tasks/{taskGid}/stories",
    );

    const gitlabGetIssue = getTool("gitlab", "get_issue");
    assertEquals(
      gitlabGetIssue.endpoint?.url,
      "https://gitlab.com/api/v4/projects/{projectId}/issues/{issueIid}",
    );
    assertEquals(gitlabGetIssue.endpoint?.params?.issueIid?.required, true);

    const gitlabGetProject = getTool("gitlab", "get_project");
    assertEquals(
      gitlabGetProject.endpoint?.url,
      "https://gitlab.com/api/v4/projects/{projectId}",
    );
    assertEquals(gitlabGetProject.endpoint?.params?.projectId?.required, true);

    const gitlabUpdateIssue = getTool("gitlab", "update_issue");
    assertEquals(gitlabUpdateIssue.endpoint?.method, "PUT");
    assertEquals(
      gitlabUpdateIssue.endpoint?.body?.state_event?.description,
      "close or reopen",
    );

    const gitlabAddIssueComment = getTool("gitlab", "add_issue_comment");
    assertEquals(gitlabAddIssueComment.endpoint?.method, "POST");
    assertEquals(gitlabAddIssueComment.endpoint?.body?.body?.required, true);

    const gitlabGetMergeRequest = getTool("gitlab", "get_merge_request");
    assertEquals(
      gitlabGetMergeRequest.endpoint?.url,
      "https://gitlab.com/api/v4/projects/{projectId}/merge_requests/{mergeRequestIid}",
    );

    const gitlabAddMergeRequestComment = getTool(
      "gitlab",
      "add_merge_request_comment",
    );
    assertEquals(gitlabAddMergeRequestComment.endpoint?.method, "POST");
    assertEquals(
      gitlabAddMergeRequestComment.endpoint?.body?.body?.required,
      true,
    );

    const jiraListSites = getTool("jira", "list_sites");
    assertEquals(
      jiraListSites.endpoint?.url,
      "https://api.atlassian.com/oauth/token/accessible-resources",
    );
    assertEquals(jiraListSites.requiresWrite, false);

    const jira = getConnector("jira");
    assertEquals(
      jira.tools.map((tool) => tool.id),
      [
        "list_sites",
        "list_projects",
        "get_project",
        "search_issues",
        "get_issue",
        "create_issue",
        "update_issue",
        "list_comments",
        "add_comment",
        "get_transitions",
        "transition_issue",
        "search_users",
      ],
    );
    assertEquals(
      jira.tools.filter((tool) => tool.endpoint).map((tool) => tool.id),
      jira.tools.map((tool) => tool.id),
    );

    const jiraListProjects = getTool("jira", "list_projects");
    assertEquals(jiraListProjects.endpoint?.method, "GET");
    assertEquals(
      jiraListProjects.endpoint?.url,
      "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/project/search",
    );
    assertEquals(jiraListProjects.endpoint?.params?.cloudId?.required, true);

    const jiraSearchIssues = getTool("jira", "search_issues");
    assertEquals(jiraSearchIssues.endpoint?.method, "GET");
    assertEquals(
      jiraSearchIssues.endpoint?.url,
      "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/search/jql",
    );
    assertEquals(jiraSearchIssues.endpoint?.params?.jql?.required, true);
    assertEquals(jiraSearchIssues.endpoint?.params?.startAt, undefined);
    assertEquals(jiraSearchIssues.endpoint?.params?.nextPageToken?.in, "query");
    assertEquals(
      jiraSearchIssues.endpoint?.response?.historicalSummary?.outputFields
        ?.some((field) => field.name === "nextPageToken"),
      true,
    );
    assertEquals(
      historicalToolSummaries["jira__search_issues"]?.outputFields
        ?.some((field) => field.name === "nextPageToken"),
      true,
    );
    assertEquals(jiraSearchIssues.endpoint?.body, undefined);

    const jiraSearchUsers = getTool("jira", "search_users");
    assertEquals(jiraSearchUsers.endpoint?.params?.query?.required, undefined);
    assertStringIncludes(
      jiraSearchUsers.endpoint?.params?.query?.description ?? "",
      "empty",
    );
    assertEquals(jiraSearchUsers.requiresWrite, false);

    const jiraGetProject = getTool("jira", "get_project");
    assertEquals(
      jiraGetProject.endpoint?.url,
      "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/project/{projectIdOrKey}",
    );
    assertEquals(
      jiraGetProject.endpoint?.params?.projectIdOrKey?.required,
      true,
    );

    const jiraGetIssue = getTool("jira", "get_issue");
    assertEquals(jiraGetIssue.endpoint?.method, "GET");
    assertEquals(
      jiraGetIssue.endpoint?.url,
      "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/{issueIdOrKey}",
    );
    assertEquals(jiraGetIssue.endpoint?.params?.issueIdOrKey?.required, true);

    const jiraCreateIssue = getTool("jira", "create_issue");
    assertEquals(jiraCreateIssue.endpoint?.method, "POST");
    assertEquals(
      jiraCreateIssue.endpoint?.url,
      "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue",
    );
    assertEquals(jiraCreateIssue.requiresWrite, true);
    assertEquals(jiraCreateIssue.endpoint?.body?.fields?.required, true);

    const jiraUpdateIssue = getTool("jira", "update_issue");
    assertEquals(jiraUpdateIssue.endpoint?.method, "PUT");
    assertEquals(
      jiraUpdateIssue.endpoint?.url,
      "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/{issueIdOrKey}",
    );
    assertEquals(jiraUpdateIssue.requiresWrite, true);
    assertEquals(jiraUpdateIssue.endpoint?.params?.issueIdOrKey?.required, true);
    assertEquals(jiraUpdateIssue.endpoint?.body?.fields?.type, "object");
    assertEquals(jiraUpdateIssue.endpoint?.body?.update?.type, "object");

    const jiraListComments = getTool("jira", "list_comments");
    assertEquals(jiraListComments.endpoint?.method, "GET");
    assertEquals(
      jiraListComments.endpoint?.url,
      "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/{issueIdOrKey}/comment",
    );
    assertEquals(jiraListComments.endpoint?.params?.issueIdOrKey?.required, true);

    const jiraAddComment = getTool("jira", "add_comment");
    assertEquals(jiraAddComment.endpoint?.method, "POST");
    assertEquals(jiraAddComment.requiresWrite, true);
    assertEquals(jiraAddComment.endpoint?.body?.body?.required, true);

    const jiraGetTransitions = getTool("jira", "get_transitions");
    assertEquals(jiraGetTransitions.endpoint?.method, "GET");
    assertEquals(
      jiraGetTransitions.endpoint?.url,
      "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/{issueIdOrKey}/transitions",
    );
    assertEquals(jiraGetTransitions.endpoint?.params?.issueIdOrKey?.required, true);

    const jiraTransitionIssue = getTool("jira", "transition_issue");
    assertEquals(jiraTransitionIssue.endpoint?.method, "POST");
    assertEquals(
      jiraTransitionIssue.endpoint?.url,
      "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/{issueIdOrKey}/transitions",
    );
    assertEquals(jiraTransitionIssue.requiresWrite, true);
    assertEquals(jiraTransitionIssue.endpoint?.params?.issueIdOrKey?.required, true);
    assertEquals(jiraTransitionIssue.endpoint?.body?.transition?.required, true);

    const notionGetPage = getTool("notion", "get_page");
    assertEquals(notionGetPage.endpoint?.method, "GET");
    assertEquals(
      notionGetPage.endpoint?.url,
      "https://api.notion.com/v1/pages/{pageId}",
    );
    assertEquals(notionGetPage.endpoint?.params?.pageId?.required, true);

    const notionGetDatabase = getTool("notion", "get_database");
    assertEquals(notionGetDatabase.endpoint?.method, "GET");
    assertEquals(
      notionGetDatabase.endpoint?.url,
      "https://api.notion.com/v1/databases/{databaseId}",
    );

    const notionAppendBlocks = getTool("notion", "append_blocks");
    assertEquals(notionAppendBlocks.endpoint?.method, "PATCH");
    assertEquals(notionAppendBlocks.endpoint?.body?.children?.required, true);

    const notionUpdatePage = getTool("notion", "update_page");
    assertEquals(notionUpdatePage.endpoint?.method, "PATCH");
    assertEquals(notionUpdatePage.endpoint?.body?.archived?.type, "boolean");

    const confluenceListSites = getTool("confluence", "list_sites");
    assertEquals(
      confluenceListSites.endpoint?.url,
      "https://api.atlassian.com/oauth/token/accessible-resources",
    );

    const confluenceGetPage = getTool("confluence", "get_page");
    assertEquals(
      confluenceGetPage.endpoint?.url,
      "https://api.atlassian.com/ex/confluence/{cloudId}/wiki/api/v2/pages/{pageId}",
    );
    assertEquals(
      confluenceGetPage.endpoint?.params?.["body-format"]?.default,
      "storage",
    );

    const outlookSendEmail = getTool("outlook", "send_email");
    assertEquals(
      outlookSendEmail.endpoint?.url,
      "https://graph.microsoft.com/v1.0/me/sendMail",
    );
    assertEquals(outlookSendEmail.endpoint?.body?.message?.required, true);

    const teamsListChannels = getTool("teams", "list_channels");
    assertEquals(
      teamsListChannels.endpoint?.url,
      "https://graph.microsoft.com/v1.0/teams/{teamId}/channels",
    );
    assertEquals(teamsListChannels.endpoint?.params?.teamId?.required, true);
    const teamsSendChatMessage = getTool("teams", "send_chat_message");
    assertEquals(
      teamsSendChatMessage.endpoint?.url,
      "https://graph.microsoft.com/v1.0/chats/{chatId}/messages",
    );
    assertEquals(teamsSendChatMessage.endpoint?.params?.chatId?.required, true);
    assertEquals(teamsSendChatMessage.endpoint?.body?.body?.required, true);
    const teams = getConnector("teams");
    assertEquals(teams.auth.scopes?.includes("Channel.ReadBasic.All"), true);

    const confluence = getConnector("confluence");
    assertEquals(
      confluence.auth.additionalAuthParams?.audience,
      "api.atlassian.com",
    );
  });

  it("keeps newly added static endpoints executor-compatible", () => {
    const driveCreateFolder = getTool("drive", "create_folder");
    assertEquals(
      driveCreateFolder.endpoint?.url,
      "https://www.googleapis.com/drive/v3/files",
    );
    assertEquals(
      driveCreateFolder.endpoint?.body?.mimeType?.default,
      "application/vnd.google-apps.folder",
    );

    const docsCreateDocument = getTool("docs-google", "create_document");
    assertEquals(
      docsCreateDocument.endpoint?.url,
      "https://docs.googleapis.com/v1/documents",
    );
    assertEquals(docsCreateDocument.endpoint?.body?.title?.required, true);

    const sheetsReadRange = getTool("sheets", "read_range");
    assertEquals(sheetsReadRange.endpoint?.params?.spreadsheetId?.in, "path");
    assertEquals(sheetsReadRange.endpoint?.params?.range?.in, "path");

    const sheetsWriteRange = getTool("sheets", "write_range");
    assertEquals(
      sheetsWriteRange.endpoint?.url,
      "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{range}",
    );
    assertEquals(sheetsWriteRange.endpoint?.method, "PUT");
    assertEquals(
      sheetsWriteRange.endpoint?.params?.spreadsheetId?.required,
      true,
    );
    assertEquals(sheetsWriteRange.endpoint?.params?.range?.required, true);
    assertEquals(sheetsWriteRange.endpoint?.body?.values?.required, true);
    assertEquals(
      sheetsWriteRange.endpoint?.params?.valueInputOption?.default,
      "USER_ENTERED",
    );

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
    const oauthMetadataTemplate =
      /{{\s*(?:oauth\.raw\.[A-Za-z0-9_.-]+|auth\.token|env\.[A-Za-z0-9_]+)\s*}}/g;

    for (const connector of connectors) {
      for (const tool of connector.tools) {
        const endpoint = tool.endpoint;
        if (!endpoint) continue;

        const urlWithoutOAuthTemplates = endpoint.url.replace(
          oauthMetadataTemplate,
          "https://oauth.example",
        );
        const pathParams = Object.entries(endpoint.params ?? {}).filter((
          [, param],
        ) => param.in === "path");

        for (const [paramName] of pathParams) {
          assertStringIncludes(
            urlWithoutOAuthTemplates,
            `{${paramName}}`,
            `${connector.name}:${
              tool.id ?? tool.name
            } declares path param ${paramName} but URL does not contain it`,
          );
        }

        for (
          const placeholder of urlWithoutOAuthTemplates.matchAll(
            /{([A-Za-z0-9_$.-]+)}/g,
          )
        ) {
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
      assertExists(
        tool.endpoint,
        `Expected airtable:${tool.id} to have an endpoint spec`,
      );
    }

    assertEquals(
      getTool("airtable", "update_record").endpoint?.method,
      "PATCH",
    );
    assertEquals(
      getTool("airtable", "delete_record").endpoint?.method,
      "DELETE",
    );
    assertEquals(
      getTool("airtable", "create_records").endpoint?.response?.transform,
      "records",
    );
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
    assertStringIncludes(
      airtableConfig.defaultScopes.join(" "),
      "schema.bases:write",
    );
  });

  it("keeps Airtable connector tools aligned with scaffolded tool files", async () => {
    const airtable = getConnector("airtable");
    const toolFiles: string[] = [];

    for await (
      const entry of Deno.readDir(
        "cli/templates/integrations/airtable/files/tools",
      )
    ) {
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

  it("keeps github connector tools aligned with scaffolded tool files", async () => {
    const github = getConnector("github");
    const toolFiles: string[] = [];

    for await (
      const entry of Deno.readDir(
        "cli/templates/integrations/github/files/tools",
      )
    ) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        toolFiles.push(entry.name.replace(/\.ts$/, ""));
      }
    }

    const expectedFiles = github.tools.map((tool) => {
      assertExists(tool.id);
      return tool.id.replaceAll("_", "-");
    }).sort();
    assertEquals(toolFiles.sort(), expectedFiles);
  });

  it("keeps gmail connector tools aligned with scaffolded tool files", async () => {
    const gmail = getConnector("gmail");
    const toolFiles: string[] = [];

    for await (
      const entry of Deno.readDir(
        "cli/templates/integrations/gmail/files/tools",
      )
    ) {
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

  it("keeps sheets connector aligned with standard spreadsheet automation tools", async () => {
    const sheets = getConnector("sheets");
    const expectedToolIds = [
      "list_spreadsheets",
      "get_spreadsheet",
      "read_range",
      "write_range",
      "create_spreadsheet",
      "append_rows",
      "clear_range",
      "batch_update",
      "add_sheet",
      "delete_sheet",
      "rename_sheet",
      "delete_spreadsheet",
      "find_replace",
      "copy_sheet",
      "create_chart",
      "set_data_validation",
    ];

    assertEquals(sheets.tools.map((tool) => tool.id), expectedToolIds);

    const toolFiles: string[] = [];
    for await (
      const entry of Deno.readDir(
        "cli/templates/integrations/sheets/files/tools",
      )
    ) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        toolFiles.push(entry.name.replace(/\.ts$/, ""));
      }
    }

    assertEquals(
      toolFiles.sort(),
      expectedToolIds.map((id) => id.replaceAll("_", "-")).sort(),
    );
  });

  it("keeps github list-issues on GraphQL so pull requests stay separate", () => {
    const githubGetRepo = getTool("github", "get_repo");
    assertEquals(githubGetRepo.endpoint?.method, "GET");
    assertEquals(githubGetRepo.endpoint?.params?.owner?.required, true);

    const githubGetIssue = getTool("github", "get_issue");
    assertEquals(githubGetIssue.endpoint?.method, "GET");
    assertEquals(githubGetIssue.endpoint?.params?.issue_number?.required, true);

    const githubUpdateIssue = getTool("github", "update_issue");
    assertEquals(githubUpdateIssue.endpoint?.method, "PATCH");
    assertEquals(
      githubUpdateIssue.endpoint?.body?.state?.description,
      "Issue state: open or closed",
    );

    const githubAddIssueComment = getTool("github", "add_issue_comment");
    assertEquals(githubAddIssueComment.endpoint?.method, "POST");
    assertEquals(githubAddIssueComment.endpoint?.body?.body?.required, true);

    const tool = getTool("github", "list_issues");

    assertEquals(tool.endpoint?.type, "graphql");
    assertEquals(tool.endpoint?.url, "https://api.github.com/graphql");
    assertEquals(tool.endpoint?.response?.transform, "repository.issues.nodes");
    assertStringIncludes(
      tool.endpoint?.query ?? "",
      "repository(owner: $owner, name: $repo)",
    );
    assertStringIncludes(
      tool.endpoint?.query ?? "",
      "issues(first: $first, states: $states",
    );
  });

  it("preserves executor-compatible defaults and GraphQL variable shapes", () => {
    const calendarUpdateEvent = getTool("calendar", "update_event");
    assertEquals(calendarUpdateEvent.endpoint?.method, "PATCH");
    assertEquals(calendarUpdateEvent.endpoint?.params?.eventId?.required, true);
    assertEquals(
      calendarUpdateEvent.endpoint?.body?.summary?.required ?? false,
      false,
    );

    const calendarDeleteEvent = getTool("calendar", "delete_event");
    assertEquals(calendarDeleteEvent.endpoint?.method, "DELETE");
    assertEquals(calendarDeleteEvent.endpoint?.params?.eventId?.required, true);

    const calendarListEvents = getTool("calendar", "list_events");
    assertEquals(
      calendarListEvents.endpoint?.params?.calendarId?.default,
      "primary",
    );
    assertEquals(
      calendarListEvents.endpoint?.params?.orderBy?.default,
      "startTime",
    );

    const gmailListEmails = getTool("gmail", "list_emails");
    assertEquals(gmailListEmails.endpoint?.params?.labelIds?.type, "string[]");
    assertEquals(
      gmailListEmails.endpoint?.response?.enrich?.type,
      "gmail-message-metadata",
    );
    assertEquals(
      gmailListEmails.endpoint?.response?.enrich?.metadataHeaders,
      ["From", "To", "Subject", "Date"],
    );

    const gmailGetEmail = getTool("gmail", "get_email");
    assertEquals(gmailGetEmail.endpoint?.params?.format?.default, "full");
    assertEquals(gmailGetEmail.endpoint?.params?.metadataHeaders?.type, "string[]");

    const gmailSearchEmails = getTool("gmail", "search_emails");
    assertEquals(
      gmailSearchEmails.endpoint?.response?.enrich?.type,
      "gmail-message-metadata",
    );

    const linearSearchIssues = getTool("linear", "search_issues");
    assertStringIncludes(
      linearSearchIssues.endpoint?.query ?? "",
      "searchIssues(term: $query, first: $first)",
    );

    const linearCreateIssue = getTool("linear", "create_issue");
    assertStringIncludes(
      linearCreateIssue.endpoint?.query ?? "",
      "issueCreate(input: {",
    );
    assertStringIncludes(
      linearCreateIssue.endpoint?.query ?? "",
      "teamId: $teamId",
    );

    const linearUpdateIssue = getTool("linear", "update_issue");
    assertStringIncludes(
      linearUpdateIssue.endpoint?.query ?? "",
      "issueUpdate(id: $id, input: {",
    );
    assertStringIncludes(
      linearUpdateIssue.endpoint?.query ?? "",
      "stateId: $stateId",
    );

    const linearListTeams = getTool("linear", "list_teams");
    assertStringIncludes(
      linearListTeams.endpoint?.query ?? "",
      "teams(first: $first)",
    );

    const linearListWorkflowStates = getTool("linear", "list_workflow_states");
    assertStringIncludes(
      linearListWorkflowStates.endpoint?.query ?? "",
      "team(id: $teamId)",
    );
    assertStringIncludes(
      linearListWorkflowStates.endpoint?.query ?? "",
      "states { nodes",
    );

    const linearListUsers = getTool("linear", "list_users");
    assertStringIncludes(
      linearListUsers.endpoint?.query ?? "",
      "users(first: $first)",
    );

    const linearDeleteIssue = getTool("linear", "delete_issue");
    assertStringIncludes(linearDeleteIssue.endpoint?.query ?? "", "issueDelete");
    assertStringIncludes(linearDeleteIssue.endpoint?.query ?? "", "permanentlyDelete");
    assertEquals(linearDeleteIssue.endpoint?.params?.id?.required, true);

    const linearAddComment = getTool("linear", "add_comment");
    assertStringIncludes(
      linearAddComment.endpoint?.query ?? "",
      "commentCreate(input: { issueId: $issueId, body: $body })",
    );
    assertEquals(linearAddComment.endpoint?.params?.body?.required, true);
  });

  it("declares the GitHub current user identity tool", () => {
    const tool = getTool("github", "get_current_user");

    assertEquals(tool.requiresWrite, false);
    assertEquals(tool.endpoint?.method, "GET");
    assertEquals(tool.endpoint?.url, "https://api.github.com/user");
    assertEquals(historicalToolSummaries["github__get_current_user"], undefined);
  });

  it("publishes provider-declared historical summary contracts for GitHub read tools", () => {
    const listRepos = getTool("github", "list_repos");
    const listIssues = getTool("github", "list_issues");
    const getIssue = getTool("github", "get_issue");
    const getPr = getTool("github", "get_pr");

    assertEquals(listRepos.endpoint?.response?.historicalSummary?.itemFields, [
      { name: "id" },
      { name: "node_id" },
      { name: "name" },
      { name: "full_name" },
      { name: "owner", kind: "contact" },
      { name: "html_url" },
      { name: "private" },
      { name: "archived" },
      { name: "open_issues_count" },
      { name: "default_branch" },
      { name: "updated_at" },
      { name: "pushed_at" },
    ]);
    assertEquals(listIssues.endpoint?.response?.historicalSummary?.outputFields, [
      { name: "pageInfo", kind: "object" },
    ]);
    assertEquals(getIssue.endpoint?.response?.historicalSummary?.singleItem, true);
    assertEquals(getPr.endpoint?.response?.historicalSummary?.singleItem, true);
    assertEquals(
      historicalToolSummaries["github__list_repos"],
      listRepos.endpoint?.response?.historicalSummary,
    );
    assertEquals(
      historicalToolSummaries["github__get_pr"],
      getPr.endpoint?.response?.historicalSummary,
    );
  });

  it("publishes the practical Outlook mail and calendar tool surface", () => {
    const outlook = getConnector("outlook");
    assertEquals(outlook.auth.scopes, [
      "Mail.Read",
      "Mail.Send",
      "Mail.ReadWrite",
      "Calendars.Read",
      "Calendars.ReadWrite",
      "Group.Read.All",
      "Group-Conversation.Read.All",
      "offline_access",
    ]);

    assertEquals(outlook.tools.map((tool) => tool.id), [
      "list_emails",
      "get_email",
      "send_email",
      "search_emails",
      "list_folders",
      "get_folder",
      "create_folder",
      "update_folder",
      "delete_folder",
      "mark_email_read",
      "mark_email_unread",
      "delete_email",
      "move_email",
      "archive_email",
      "flag_email",
      "clear_email_flag",
      "categorize_email",
      "list_categories",
      "create_category",
      "update_category",
      "delete_category",
      "create_draft",
      "list_drafts",
      "get_draft",
      "update_draft",
      "send_draft",
      "delete_draft",
      "reply_email",
      "reply_all_email",
      "forward_email",
      "create_reply_draft",
      "create_reply_all_draft",
      "create_forward_draft",
      "list_attachments",
      "get_attachment",
      "add_attachment_to_message",
      "list_conversation_messages",
      "list_shared_mailbox_emails",
      "search_shared_mailbox_emails",
      "find_group_by_mail",
      "list_group_threads",
      "list_group_thread_posts",
      "list_calendars",
      "get_calendar",
      "create_calendar",
      "update_calendar",
      "delete_calendar",
      "list_events",
      "list_calendar_view",
      "get_event",
      "create_event",
      "update_event",
      "delete_event",
      "respond_to_event",
      "get_event_instances",
      "list_event_attachments",
      "get_event_attachment",
      "add_event_attachment",
      "find_free_time",
      "get_schedule",
      "find_meeting_times",
    ]);

    assertEquals(
      getTool("outlook", "list_calendar_view").endpoint?.url,
      "https://graph.microsoft.com/v1.0/me/calendarView",
    );
    assertEquals(
      getTool("outlook", "archive_email").endpoint?.url,
      "https://graph.microsoft.com/v1.0/me/messages/{messageId}/move",
    );
    assertEquals(
      getTool("outlook", "find_meeting_times").endpoint?.url,
      "https://graph.microsoft.com/v1.0/me/findMeetingTimes",
    );
    assertEquals(
      getTool("outlook", "search_emails").endpoint?.params?.query
        ?.queryValueFormat,
      "microsoft-graph-search",
    );
    assertEquals(
      getTool("outlook", "list_conversation_messages").endpoint?.params?.["$orderby"],
      undefined,
    );
    assertEquals(
      getTool("outlook", "list_shared_mailbox_emails").endpoint?.url,
      "https://graph.microsoft.com/v1.0/users/{mailbox}/mailFolders/{folderId}/messages",
    );
    assertEquals(
      getTool("outlook", "search_shared_mailbox_emails").endpoint?.url,
      "https://graph.microsoft.com/v1.0/users/{mailbox}/messages",
    );
    assertEquals(
      getTool("outlook", "search_shared_mailbox_emails").endpoint?.params?.query
        ?.queryValueFormat,
      "microsoft-graph-search",
    );
    assertEquals(
      getTool("outlook", "find_group_by_mail").endpoint?.url,
      "https://graph.microsoft.com/v1.0/groups?$filter=mail eq '{mailAddress}'",
    );
    assertEquals(
      getTool("outlook", "list_group_threads").endpoint?.url,
      "https://graph.microsoft.com/v1.0/groups/{groupId}/threads",
    );
    assertEquals(
      getTool("outlook", "list_group_thread_posts").endpoint?.url,
      "https://graph.microsoft.com/v1.0/groups/{groupId}/threads/{threadId}/posts",
    );
    assertEquals(getTool("outlook", "add_attachment_to_message").endpoint?.body, {
      "@odata.type": {
        type: "string",
        description: "Microsoft Graph attachment type",
        default: "#microsoft.graph.fileAttachment",
      },
      name: {
        type: "string",
        description: "Attachment filename",
        required: true,
      },
      contentBytes: {
        type: "string",
        description: "Base64-encoded attachment content",
        required: true,
      },
      contentType: {
        type: "string",
        description: "Attachment MIME type",
      },
      isInline: {
        type: "boolean",
        description: "Whether the attachment is inline",
        default: false,
      },
    });
    assertEquals(
      getTool("outlook", "add_event_attachment").endpoint?.body,
      getTool("outlook", "add_attachment_to_message").endpoint?.body,
    );
  });

  it("publishes provider-declared historical summary contracts for email list/search tools", () => {
    const gmailListEmails = getTool("gmail", "list_emails");
    const outlookListEmails = getTool("outlook", "list_emails");

    assertEquals(gmailListEmails.endpoint?.response?.historicalSummary, {
      collectionKeys: ["messages", "data"],
      collectionName: "messages",
      itemFields: [
        { name: "id" },
        { name: "threadId" },
        { name: "from", kind: "contact" },
        { name: "sender", kind: "contact" },
        { name: "to" },
        { name: "subject" },
        { name: "date" },
        { name: "internalDate" },
        { name: "snippet", maxLength: 300 },
        { name: "labelIds", kind: "string-array" },
        { name: "isUnread" },
        { name: "unread" },
      ],
      outputFields: [{ name: "nextPageToken" }, { name: "resultSizeEstimate" }],
      omitted: "large email bodies and provider-specific payload fields",
    });
    assertEquals(outlookListEmails.endpoint?.response?.historicalSummary?.outputFields, [
      { name: "@odata.nextLink" },
      { name: "@odata.count" },
    ]);
    assertEquals(
      historicalToolSummaries["gmail__list_emails"],
      gmailListEmails.endpoint?.response?.historicalSummary,
    );
    assertEquals(
      historicalToolSummaries["outlook__search_emails"],
      getTool("outlook", "search_emails").endpoint?.response?.historicalSummary,
    );
    assertEquals(historicalToolSummaries["custom__search_emails"], undefined);
  });

  it("publishes current-run summary coverage for priority collection tools", () => {
    const priorityConnectors = [
      "gmail",
      "outlook",
      "harvest",
      "github",
      "slack",
      "asana",
      "jira",
      "linear",
    ];
    const collectionToolPattern =
      /^(list|search|query|report|time_report|invoice_report|find_free_time|get_schedule|find_meeting_times)_?/;

    for (const connectorName of priorityConnectors) {
      const connector = getConnector(connectorName);
      for (const tool of connector.tools) {
        if (
          tool.requiresWrite !== false ||
          !tool.endpoint ||
          !tool.id ||
          !collectionToolPattern.test(tool.id)
        ) {
          continue;
        }

        assertExists(
          tool.endpoint.response?.historicalSummary,
          `Expected ${connectorName}__${tool.id} to declare historicalSummary`,
        );
        assertEquals(
          historicalToolSummaries[`${connectorName}__${tool.id}`],
          tool.endpoint.response?.historicalSummary,
        );
      }
    }
  });
});
