import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { airtableConfig } from "../oauth/providers/common.ts";
import { connectors, icons } from "./_data.ts";
import { historicalToolSummaries } from "./_tool_summaries.ts";
import { filterVisibleIntegrations } from "./feature-flags.ts";
import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { fromFileUrl } from "#veryfront/platform/compat/path/index.ts";

function getConnector(name: string) {
  const connector = connectors.find((item) => item.name === name);
  assertExists(connector, `Expected connector ${name} to exist`);
  return connector;
}

function getTool(connectorName: string, toolId: string) {
  const connector = getConnector(connectorName);
  const namespacedToolId = getNamespacedToolId(connectorName, toolId);
  const tool = connector.tools.find((item) => item.id === toolId || item.id === namespacedToolId);
  assertExists(tool, `Expected ${connectorName}:${toolId} to exist`);
  return tool;
}

function getNamespacedToolId(connectorName: string, toolId: string): string {
  const prefix = `${connectorName}__`;
  return toolId.startsWith(prefix) ? toolId : `${prefix}${toolId}`;
}

function getConnectorLocalToolId(connectorName: string, toolId: string): string {
  const prefix = `${connectorName}__`;
  return toolId.startsWith(prefix) ? toolId.slice(prefix.length) : toolId;
}

function getLocalToolIds(connectorName: string, tools: { id?: string }[]): (string | undefined)[] {
  return tools.map((tool) => tool.id ? getConnectorLocalToolId(connectorName, tool.id) : tool.id);
}

describe("integration endpoint specs", () => {
  it("keeps every generated tool summary between two and six words", () => {
    for (const connector of connectors) {
      for (const tool of connector.tools) {
        assert(
          tool.description.trim().split(/\s+/).length >= 2 &&
            tool.description.trim().split(/\s+/).length <= 6,
          `${connector.name}:${tool.id} must use an action/resource summary of two to six words`,
        );
      }
    }
  });
  it("keeps asynchronous and conversation-window semantics in short summaries", () => {
    const expected: [string, string, string][] = [
      ["adyen", "create_refund", "Start payment refund"],
      ["new-relic", "list_issues", "List issues (24 hours, maximum 100)"],
      ["e2b", "list_sandboxes", "List running sandboxes"],
      ["persona", "approve_inquiry", "Approve inquiry after compliance review"],
      ["persona", "decline_inquiry", "Decline inquiry after compliance review"],
      ["onedrive", "delete_file", "Move file to recycle bin"],
      ["redis-cloud", "list_subscriptions", "List Pro subscriptions"],
      ["redis-cloud", "list_databases", "List Pro databases"],
      ["redis-cloud", "get_database", "Get Pro database"],
      ["replicate", "list_models", "List public models"],
      ["rippling", "list_employees", "List active employees"],
      ["sap", "release_supplier_invoice", "Release blocked supplier invoice"],
      ["sheets", "clear_range", "Clear range values"],
      ["teams", "list_teams", "List joined teams"],
      ["todoist", "list_tasks", "List active tasks"],
      ["wix", "create_fulfillment", "Mark order items as fulfilled"],
      ["daytona", "delete_sandbox", "Delete sandbox and its filesystem"],
      ["e2b", "kill_sandbox", "Destroy sandbox and discard state"],
      ["klarna", "cancel_order", "Cancel uncaptured order"],
      ["klarna", "refund_order", "Refund captured order amount"],
      ["wix", "query_contacts", "Query contacts (1000 maximum per request)"],
      ["gocardless", "retry_payment", "Retry failed payment"],
      ["unzer", "cancel_authorization", "Cancel uncaptured authorization"],
      ["trusted-shops", "reply_to_review", "Save public review reply"],
      ["guru", "verify_card", "Mark card as verified"],
      ["google-analytics", "run_realtime_report", "Run realtime report (last 30 minutes)"],
      ["google-contacts", "create_contact", "Create contact (requires full Contacts scope)"],
      ["google-contacts", "update_contact", "Update contact (requires full Contacts scope)"],
      ["stackit", "list_projects", "List projects (requires parent or member)"],
      ["box", "upload_file", "Upload file (50 MB maximum)"],
      ["box", "upload_file_version", "Upload file version (50 MB maximum)"],
      ["pandadoc", "send_document", "Send draft document"],
      ["zoho-crm", "create_records", "Create up to 100 CRM records"],
      ["sheets", "find_replace", "Find and replace spreadsheet text"],
      ["lexoffice", "get_invoice_document", "Render non-draft invoice PDF"],
      ["xero", "create_invoice_attachment", "Create invoice attachment (25 MB maximum)"],
      ["rippling", "process_leave_request", "Process pending leave request"],
      ["pandadoc", "create_document_from_template", "Create draft document from template"],
      ["openai", "delete_file", "Delete file and all vector-store references"],
      ["north-data", "power_search", "Search narrowly; billed per unique company"],
      ["openai", "get_usage_completions", "Get completions usage (requires admin key)"],
      ["openai", "get_costs", "Get costs (requires organization admin key)"],
      ["openai", "get_usage_embeddings", "Get embeddings usage (requires admin key)"],
      ["openrouter", "get_credits", "Get credits (requires management key)"],
      ["apify", "run_actor_sync", "Run actor synchronously (consumes credits)"],
      ["daytona", "create_sandbox", "Create billable sandbox"],
      ["daytona", "stop_sandbox", "Stop sandbox; clear memory"],
      ["digitalocean", "create_droplet", "Create billable droplet"],
      ["e2b", "create_sandbox", "Create billable sandbox"],
      ["hetzner", "create_server", "Create billable server"],
      ["fal", "run_model", "Run model (billed per run)"],
      ["fal", "queue_submit", "Submit queue request (billed per run)"],
      ["stability-ai", "text_to_image", "Generate image (consumes credits)"],
      ["north-data", "get_person", "Get person (billed lookup)"],
      ["north-data", "suggest", "Suggest companies and people (unbilled)"],
      ["google-bigquery", "preview_table_data", "Preview table data without query charges"],
      ["harvest", "delete_time_entry", "Delete unlocked, unbilled time entry"],
      ["azure-blob-storage", "list_containers", "List containers as XML"],
      ["azure-blob-storage", "list_blobs", "List blobs as XML"],
      ["elevenlabs", "text_to_speech", "Generate binary speech audio"],
      ["drive", "download_file", "Download file (excludes Docs/Sheets/Slides)"],
      ["fal", "queue_cancel", "Cancel pending queue request"],
      ["browserbase", "release_session", "Request session release to stop billing"],
      ["bamboohr", "create_time_off_request", "Request time off approval"],
      ["mindee", "parse_invoice", "Parse invoice (consumes page quota)"],
      ["mindee", "parse_receipt", "Parse receipt (consumes page quota)"],
      ["mindee", "parse_financial_document", "Parse financial document (consumes page quota)"],
      ["sendcloud", "cancel_shipment", "Cancel shipment before carrier collection"],
      ["unzer", "authorize_payment", "Authorize payment (approximately seven-day hold)"],
      ["power-bi", "execute_dax_query", "Run read-only DAX query"],
      ["salesforce", "run_soql_query", "Run read-only SOQL query"],
      ["google-bigquery", "run_query", "Run SQL query (SELECT by default)"],
      ["gmail", "delete_email", "Permanently delete email"],
      ["gmail", "batch_delete_emails", "Permanently delete multiple emails"],
      ["gmail", "delete_thread", "Permanently delete thread"],
      ["gmail", "delete_draft", "Permanently delete draft"],
      ["drive", "delete_file", "Permanently delete file"],
      ["gcp", "start_compute_instance", "Request compute instance start"],
      ["gcp", "stop_compute_instance", "Request compute instance stop"],
      ["stackit", "start_server", "Request server start"],
      ["stackit", "stop_server", "Request server stop without reducing charges"],
      ["stackit", "reboot_server", "Request server reboot"],
      ["whatsapp", "get_media_url", "Get temporary media download URL"],
      ["hubspot", "remove_association", "Remove all associations between records"],
      ["databricks", "cancel_job_run", "Request job run cancellation"],
      ["assemblyai", "delete_transcript", "Permanently delete transcript and data"],
      ["digitalocean", "delete_droplet", "Permanently destroy droplet"],
      ["google-cloud-storage", "delete_object", "Delete object (may be permanent)"],
      ["sprites", "delete_sprite", "Permanently destroy sprite and filesystem"],
      ["sprites", "restore_checkpoint", "Replace sprite state with checkpoint"],
      ["gmail", "update_draft", "Replace draft"],
      ["e2b", "set_sandbox_timeout", "Reset sandbox timeout"],
      ["databricks", "get_sql_statement", "Poll SQL statement status and result"],
      ["azure-document-intelligence", "get_analyze_result", "Poll document analysis result"],
      ["ionos", "get_request_status", "Poll asynchronous request status"],
      ["ionos", "start_server", "Start Enterprise server"],
      ["ionos", "stop_server", "Request Enterprise poweroff; release unreserved IPs"],
      ["apollo", "search_organizations", "Search organizations (consumes credits)"],
      ["apollo", "enrich_person", "Enrich person (consumes credits)"],
      ["apollo", "enrich_organization", "Enrich organization (consumes credits)"],
      ["onedrive", "upload_file", "Create or overwrite file"],
      ["gemini", "upload_file", "Upload temporary file (48-hour retention)"],
      ["qonto", "upload_transaction_attachment", "Start transaction attachment upload"],
      ["qonto", "get_attachment", "Get attachment with expiring download URL"],
      ["azure", "start_virtual_machine", "Request virtual machine start"],
      ["azure", "deallocate_virtual_machine", "Request virtual machine deallocation"],
      ["azure", "restart_virtual_machine", "Request virtual machine restart"],
      ["assemblyai", "submit_transcript", "Start audio transcription"],
      ["help-scout", "add_note", "Add internal conversation note"],
      ["amplitude", "list_events", "List event types"],
      ["azure-blob-storage", "copy_blob", "Start blob copy"],
      ["power-bi", "refresh_dataset", "Start dataset refresh"],
      ["power-bi", "refresh_workspace_dataset", "Start workspace dataset refresh"],
      ["whatsapp", "send_text_message", "Send text within 24-hour window"],
      ["whatsapp", "send_media_message", "Send media within 24-hour window"],
      ["whatsapp", "send_template_message", "Send template to start conversation"],
    ];
    for (const [connectorName, toolName, summary] of expected) {
      assertEquals(getTool(connectorName, toolName).description, summary);
    }
  });
  it("keeps operation limits, cross-field requirements and OAuth scopes visible in inputs", () => {
    const expected: [string, string, "params" | "body", string, string][] = [
      [
        "new-relic",
        "list_issues",
        "params",
        "accountId",
        "This operation queries NrAiIssue with fixed SINCE 1 day ago and LIMIT 100 clauses. No time-window or pagination controls are exposed; older issues and results beyond the limit are not included.",
      ],
      [
        "e2b",
        "list_sandboxes",
        "params",
        "metadata",
        "This operation lists running sandboxes only. Paused sandboxes are excluded; the provider state filter is not exposed by this tool.",
      ],
      [
        "persona",
        "approve_inquiry",
        "params",
        "inquiryId",
        "Complete compliance review before approval. Approving prevents further inquiry progress and triggers associated workflows and webhooks.",
      ],
      [
        "persona",
        "decline_inquiry",
        "params",
        "inquiryId",
        "Complete compliance review before declining. Declining prevents further inquiry progress and triggers associated workflows and webhooks.",
      ],
      [
        "google-bigquery",
        "run_query",
        "body",
        "query",
        "The default read-only scope supports SELECT queries only. DML statements (INSERT, UPDATE, DELETE) require the optional https://www.googleapis.com/auth/bigquery OAuth scope.",
      ],
      [
        "hetzner",
        "power_off_server",
        "params",
        "serverId",
        "Hard power-off is like pulling the power plug; unsaved data can be lost if the operating system is running.",
      ],
      [
        "ionos",
        "stop_server",
        "params",
        "serverId",
        "This forcefully powers off an Enterprise server and stops compute billing. Unreserved public IPv4 addresses are released; reserved IPs are kept. CUBE servers cannot use this endpoint and use suspend/resume instead.",
      ],
      [
        "billbee",
        "list_invoices",
        "params",
        "page",
        "Calls with the same page and minInvoiceDate are throttled to one request per minute.",
      ],
      [
        "azure-blob-storage",
        "copy_blob",
        "params",
        "blobName",
        "Accepted copies return HTTP 202 with x-ms-copy-status success or pending. When pending, poll the destination blob until completion before using the copy.",
      ],
      [
        "azure-document-intelligence",
        "analyze_invoice",
        "body",
        "urlSource",
        "Analysis is asynchronous: HTTP 202 returns an Operation-Location header containing the result ID. Poll Get Analyze Result with that ID and the same model.",
      ],
      [
        "azure-document-intelligence",
        "analyze_receipt",
        "body",
        "urlSource",
        "Analysis is asynchronous: HTTP 202 returns an Operation-Location header containing the result ID. Poll Get Analyze Result with that ID and the same model.",
      ],
      [
        "azure-document-intelligence",
        "analyze_layout",
        "body",
        "urlSource",
        "Analysis is asynchronous: HTTP 202 returns an Operation-Location header containing the result ID. Poll Get Analyze Result with that ID and the same model.",
      ],
      [
        "azure-document-intelligence",
        "analyze_read",
        "body",
        "urlSource",
        "Analysis is asynchronous: HTTP 202 returns an Operation-Location header containing the result ID. Poll Get Analyze Result with that ID and the same model.",
      ],
      [
        "azure-document-intelligence",
        "get_analyze_result",
        "params",
        "resultId",
        "Use the same model ID that started the analysis. While status is running, wait and poll again; extracted fields are available in analyzeResult when status is succeeded.",
      ],
      [
        "adyen",
        "capture_payment",
        "params",
        "paymentPspReference",
        "Capture is asynchronous; its outcome arrives through a CAPTURE webhook. The immediate response is not final capture outcome evidence.",
      ],
      [
        "onedrive",
        "delete_file",
        "params",
        "itemId",
        "Deletion moves this file or folder to the recycle bin instead of permanently deleting it.",
      ],
      [
        "pandadoc",
        "create_document_link",
        "body",
        "recipient",
        "Creates a session link for this recipient to view and sign an already-sent document. This operation does not email the link to the recipient.",
      ],
      [
        "redis-cloud",
        "list_databases",
        "params",
        "subscriptionId",
        "This is a Redis Cloud Pro subscription ID; Essentials subscriptions use the separate fixed-subscription tools.",
      ],
      [
        "redis-cloud",
        "get_database",
        "params",
        "subscriptionId",
        "This is a Redis Cloud Pro subscription ID; Essentials subscriptions use the separate fixed-subscription tools.",
      ],
      [
        "salesforce",
        "search_knowledge_articles",
        "params",
        "q",
        "The default query selects published articles with PublishStatus = Online; other authorized publication states require an explicit query.",
      ],
      [
        "sap",
        "release_supplier_invoice",
        "params",
        "SupplierInvoice",
        "This operation releases an invoice that is blocked.",
      ],
      [
        "servicenow",
        "create_request_item",
        "body",
        "request",
        "This inserts a sc_req_item record directly. Use it only when direct table writes are allowed; use Order Catalog Item for the normal catalog-order workflow.",
      ],
      [
        "slack",
        "update_message",
        "body",
        "ts",
        "Only messages previously sent by this integration can be updated.",
      ],
      [
        "slack",
        "delete_message",
        "body",
        "ts",
        "Only messages previously sent by this integration can be deleted.",
      ],
      [
        "sheets",
        "clear_range",
        "params",
        "range",
        "This clears cell values only; it does not delete cells or remove their formatting.",
      ],
      [
        "sprites",
        "exec_command",
        "params",
        "cmd",
        "This HTTP operation is non-interactive and does not provide a TTY; use commands that do not require an interactive terminal.",
      ],
      [
        "sprites",
        "create_checkpoint",
        "params",
        "name",
        "Creates a point-in-time checkpoint of sprite state and returns streaming NDJSON progress. Services may be interrupted during checkpoint creation; wait for the completion event before using the checkpoint.",
      ],
      [
        "sprites",
        "restore_checkpoint",
        "params",
        "checkpointId",
        "Restoring replaces the current filesystem with the checkpoint; changes made after that checkpoint are lost. The response contains streaming NDJSON progress; wait for completion.",
      ],
      [
        "sprites",
        "delete_sprite",
        "params",
        "name",
        "Destruction permanently deletes the sprite filesystem, packages and checkpoints; there is no undo.",
      ],
      [
        "whatsapp",
        "mark_message_read",
        "body",
        "message_id",
        "This marks an inbound message as read and sends a read receipt visible to the customer.",
      ],
      [
        "wix",
        "create_fulfillment",
        "body",
        "fulfillment",
        "Creating this fulfillment marks the included order line items as fulfilled.",
      ],
      [
        "daytona",
        "stop_sandbox",
        "params",
        "sandboxIdOrName",
        "Stopping clears memory and running processes. Regular container and VM files are retained for restart, but GPU and ephemeral sandboxes lose their local filesystem on stop. Compute charges continue during stopping and end once stopped or deleted; reserved disk remains billed while stopped. Pause is a separate operation that preserves VM memory; containers do not support pause.",
      ],
      [
        "daytona",
        "delete_sandbox",
        "params",
        "sandboxIdOrName",
        "Deleting removes this sandbox and its local filesystem; unsnapshotted local state is lost. Save needed files or create a snapshot first. Independent snapshots are preserved and remain billed for storage.",
      ],
      [
        "e2b",
        "kill_sandbox",
        "params",
        "sandboxID",
        "Killing immediately terminates this sandbox and discards its active state. Use Pause Sandbox instead when you need to resume it.",
      ],
      [
        "adyen",
        "create_refund",
        "params",
        "paymentPspReference",
        "Refund all or part of a captured payment; the outcome arrives asynchronously through a REFUND webhook.",
      ],
      [
        "fal",
        "queue_cancel",
        "params",
        "request_id",
        "Only queued requests that have not started running can be canceled; this does not stop an already running request.",
      ],
      [
        "qonto",
        "get_attachment",
        "params",
        "attachmentId",
        "Returns a fresh download URL that expires after 30 minutes; fetch it again before any delayed download.",
      ],
      [
        "klarna",
        "release_remaining_authorization",
        "params",
        "orderId",
        "Use after the final partial capture to free the remaining uncaptured authorization; this does not refund captured funds.",
      ],
      [
        "apify",
        "run_actor_sync",
        "params",
        "timeout",
        "This parameter limits actor execution separately from the HTTP wait. The endpoint waits at most 300 seconds. An HTTP timeout does not prove the actor stopped; it may keep running and consuming credits. Check the existing run before retrying to avoid creating a duplicate run.",
      ],
      [
        "klarna",
        "cancel_order",
        "params",
        "orderId",
        "Only uncaptured orders that are not closed can be canceled. Any previous captures prevent cancellation. After capture, use a refund or release the remaining authorization as appropriate.",
      ],
      [
        "klarna",
        "refund_order",
        "params",
        "orderId",
        "Refunds return a full or partial captured amount; they do not release an uncaptured authorization.",
      ],
      [
        "wix",
        "query_contacts",
        "body",
        "query",
        "query.paging.limit must not exceed 1000 contacts per request.",
      ],
      [
        "gocardless",
        "retry_payment",
        "params",
        "paymentId",
        "Retry only if the mandate remains active. A failed payment can be manually retried at most three times.",
      ],
      [
        "box",
        "download_file",
        "params",
        "fileId",
        "A 202 response with Retry-After means the file is not ready; wait for the indicated delay before retrying.",
      ],
      [
        "unzer",
        "cancel_authorization",
        "params",
        "paymentId",
        "This reverses an uncaptured authorization fully or partially, releasing reserved funds; it does not refund captured charges.",
      ],
      [
        "unstructured",
        "partition_document",
        "body",
        "files",
        "Remote URLs are not accepted; fetch the file first and provide its content.",
      ],
      [
        "stackit",
        "list_projects",
        "params",
        "containerParentId",
        "At least one of containerParentId or member is required.",
      ],
      [
        "stackit",
        "list_projects",
        "params",
        "member",
        "At least one of containerParentId or member is required.",
      ],
      [
        "box",
        "upload_file",
        "body",
        "file",
        "The decoded file must not exceed 50 MB. Larger files require the chunked upload API, which this connector does not expose.",
      ],
      [
        "box",
        "upload_file_version",
        "body",
        "file",
        "The decoded file must not exceed 50 MB. Larger files require the chunked upload API, which this connector does not expose.",
      ],
      [
        "zoho-crm",
        "create_records",
        "body",
        "data",
        "At most 100 records per request. Requires the ZohoCRM.modules.CREATE OAuth scope.",
      ],
      [
        "zoho-crm",
        "update_record",
        "body",
        "data",
        "Requires the ZohoCRM.modules.UPDATE OAuth scope.",
      ],
      [
        "gcp",
        "start_compute_instance",
        "params",
        "instance",
        "Requires the https://www.googleapis.com/auth/cloud-platform OAuth scope; the default read-only scopes do not authorize this operation.",
      ],
      [
        "gcp",
        "stop_compute_instance",
        "params",
        "instance",
        "Requires the https://www.googleapis.com/auth/cloud-platform OAuth scope; the default read-only scopes do not authorize this operation.",
      ],
      [
        "gcp",
        "list_cloud_functions",
        "params",
        "projectId",
        "Requires the https://www.googleapis.com/auth/cloud-platform OAuth scope; the default read-only scopes are insufficient.",
      ],
      [
        "google-cloud-storage",
        "upload_object",
        "body",
        "content",
        "Requires the https://www.googleapis.com/auth/devstorage.read_write OAuth scope; the default read-only scope does not authorize writes.",
      ],
      [
        "google-cloud-storage",
        "copy_object",
        "params",
        "sourceBucket",
        "Requires the https://www.googleapis.com/auth/devstorage.read_write OAuth scope; the default read-only scope does not authorize writes.",
      ],
      [
        "google-cloud-storage",
        "delete_object",
        "params",
        "objectName",
        "Requires the https://www.googleapis.com/auth/devstorage.read_write OAuth scope; the default read-only scope does not authorize writes.",
      ],
      [
        "google-forms",
        "set_publish_settings",
        "params",
        "formId",
        "Requires the https://www.googleapis.com/auth/forms.body OAuth scope; the default read-only scopes do not authorize writes.",
      ],
      [
        "bamboohr",
        "update_time_off_request_status",
        "body",
        "status",
        "The API user must have approval permissions.",
      ],
      [
        "cal-com",
        "reschedule_booking",
        "params",
        "bookingUid",
        "Only accepted or pending bookings can be rescheduled.",
      ],
      [
        "shopware",
        "create_product",
        "body",
        "product",
        "Requires name, productNumber, stock, taxId, and a price array.",
      ],
      [
        "lexoffice",
        "get_invoice_document",
        "params",
        "id",
        "Draft invoices have no document file and are rejected; use a non-draft invoice.",
      ],
      [
        "xero",
        "create_invoice_attachment",
        "body",
        "content",
        "The decoded file must not exceed 25 MB. At most 10 attachments are allowed per invoice.",
      ],
      [
        "rippling",
        "process_leave_request",
        "params",
        "leaveRequestId",
        "The leave request must be pending.",
      ],
    ];
    for (const [connector, tool, location, field, requirement] of expected) {
      assertStringIncludes(
        String(getTool(connector, tool).endpoint?.[location]?.[field]?.description),
        requirement,
      );
    }
  });
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

  it("keeps Salesforce write tools curated instead of exposing generic record mutation", () => {
    const salesforce = getConnector("salesforce");
    const toolIds = getLocalToolIds("salesforce", salesforce.tools);

    assertEquals(toolIds.includes("create_record"), false);
    assertEquals(toolIds.includes("update_record"), false);
    assertEquals(toolIds.includes("delete_record"), false);
    assertEquals(getTool("salesforce", "create_case").requiresWrite, true);
    assertEquals(
      Object.keys(getTool("salesforce", "create_case").endpoint?.body ?? {}).sort(),
      [
        "AccountId",
        "ContactId",
        "Description",
        "Origin",
        "OwnerId",
        "Priority",
        "Reason",
        "Status",
        "Subject",
        "SuppliedEmail",
        "Type",
      ],
    );
    assertEquals(getTool("salesforce", "add_case_comment").endpoint?.method, "POST");
    assertEquals(getTool("salesforce", "update_case").endpoint?.method, "PATCH");
    assertEquals(
      Object.keys(getTool("salesforce", "update_case").endpoint?.body ?? {}).sort(),
      [
        "AccountId",
        "ContactId",
        "Description",
        "Origin",
        "OwnerId",
        "Priority",
        "Reason",
        "Status",
        "Subject",
        "SuppliedEmail",
        "Type",
      ],
    );

    const servicenow = getConnector("servicenow");
    const servicenowToolIds = getLocalToolIds("servicenow", servicenow.tools);
    assertEquals(servicenowToolIds.includes("query_table"), false);
    assertEquals(servicenowToolIds.includes("create_table_record"), false);
    assertEquals(servicenowToolIds.includes("update_table_record"), false);
    assertEquals(getTool("servicenow", "create_incident").requiresWrite, true);
    assertEquals(getTool("servicenow", "update_incident").endpoint?.method, "PATCH");
  });

  it("declares the Salesforce baseline tools", () => {
    const connector = getConnector("salesforce");

    assertEquals(
      getLocalToolIds("salesforce", connector.tools),
      [
        "find_customer",
        "search_accounts",
        "get_account",
        "search_contacts",
        "get_contact",
        "list_cases",
        "get_case",
        "list_case_activity",
        "search_knowledge_articles",
        "list_opportunities",
        "create_lead",
        "create_case",
        "add_case_comment",
        "update_case",
        "describe_object",
        "run_soql_query",
      ],
    );
  });

  it("opts only scoped Salesforce SOQL defaults into model-facing schemas", () => {
    const connector = getConnector("salesforce");
    const exposedToolIds: string[] = [];
    let exposedDefaults = 0;

    for (const tool of connector.tools) {
      const query = tool.endpoint?.params?.q;
      if (query?.default === undefined) continue;

      assertEquals(
        query.exposeDefault,
        true,
        `Expected ${tool.id} to expose its safe SOQL default`,
      );
      assertExists(tool.id, "Expected exposed Salesforce tools to declare an id");
      exposedToolIds.push(tool.id);
      exposedDefaults += 1;
    }

    assertEquals(exposedToolIds, [
      "salesforce__find_customer",
      "salesforce__search_accounts",
      "salesforce__search_contacts",
      "salesforce__list_cases",
      "salesforce__list_case_activity",
      "salesforce__search_knowledge_articles",
      "salesforce__list_opportunities",
    ]);
    assertEquals(exposedDefaults, 7);
  });

  it("declares Service Cloud support tools", () => {
    const expected = [
      "find_customer",
      "list_cases",
      "get_case",
      "list_case_activity",
      "search_knowledge_articles",
      "add_case_comment",
      "update_case",
      "create_case",
    ];

    for (const toolId of expected) {
      const tool = getTool("salesforce", toolId);
      assertExists(tool, `Expected salesforce:${toolId}`);
    }
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
    const toolIds = getLocalToolIds("hubspot", hubspot.tools);

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

  it("publishes all connector tool IDs with their integration namespace prefix", () => {
    const seenToolIds = new Set<string>();
    let toolCount = 0;

    for (const connector of connectors) {
      const prefix = `${connector.name}__`;

      for (const tool of connector.tools) {
        if (!tool.id) continue;
        assertEquals(
          tool.id.startsWith(prefix),
          true,
          `Expected ${connector.name}:${tool.id} to start with ${prefix}`,
        );
        assertEquals(
          tool.id.indexOf("__"),
          tool.id.lastIndexOf("__"),
          `Expected ${connector.name}:${tool.id} to contain a single namespace separator`,
        );
        assertEquals(
          seenToolIds.has(tool.id),
          false,
          `Duplicate canonical tool ID ${tool.id} (second occurrence in ${connector.name})`,
        );
        seenToolIds.add(tool.id);
        toolCount += 1;
      }
    }

    assertEquals(
      seenToolIds.size,
      toolCount,
      "every catalog tool ID must be unique across all connectors",
    );
    assertExists(getTool("harvest", "harvest__list_accounts"));
  });

  it("keeps source connector template tool IDs prefixed before generation", async () => {
    let inspectedTemplates = 0;
    let checkedToolIds = 0;

    for await (const entry of Deno.readDir("templates/integrations")) {
      if (!entry.isDirectory || entry.name === "_base") continue;

      let raw: string;
      try {
        raw = await Deno.readTextFile(
          `templates/integrations/${entry.name}/connector.json`,
        );
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          throw new Error(`templates/integrations/${entry.name} has no connector.json`);
        }
        throw error;
      }
      const connector = JSON.parse(raw) as {
        name?: string;
        tools?: Array<{ id?: string }>;
      };
      inspectedTemplates += 1;
      const connectorName = connector.name ?? entry.name;
      const prefix = `${connectorName}__`;

      for (const tool of connector.tools ?? []) {
        if (!tool.id) continue;
        assertEquals(
          tool.id.startsWith(prefix),
          true,
          `Expected ${entry.name}:${tool.id} to start with ${prefix}`,
        );
        assertEquals(
          tool.id.indexOf("__"),
          tool.id.lastIndexOf("__"),
          `Expected ${entry.name}:${tool.id} to contain a single namespace separator`,
        );
        checkedToolIds += 1;
      }
    }

    assert(inspectedTemplates > 0, "expected at least one connector template to be inspected");
    assert(checkedToolIds > 0, "expected at least one template tool id to be checked");
  });

  it("uses the documented SAP supplier invoice release function import", () => {
    const tool = getTool("sap", "release_supplier_invoice");

    assertEquals(tool.requiresWrite, true);
    assertEquals(tool.endpoint?.method, "POST");
    assertEquals(
      tool.endpoint?.url,
      "https://{{env.SAP_HOST}}/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/Release",
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
    assertEquals(
      figma.tools.some((tool) =>
        tool.id && getConnectorLocalToolId("figma", tool.id) === "list_projects"
      ),
      false,
    );
    assertEquals(
      figma.tools.some((tool) =>
        tool.id && getConnectorLocalToolId("figma", tool.id) === "list_files"
      ),
      false,
    );

    const getFile = getTool("figma", "get_file");
    assertEquals(getFile.description, "Get file");
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
      ["outlook", 60],
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
      getLocalToolIds("sentry", endpointTools).sort(),
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
      getLocalToolIds("jira", jira.tools),
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
      getLocalToolIds("jira", jira.tools.filter((tool) => tool.endpoint)),
      getLocalToolIds("jira", jira.tools),
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
      jiraSearchIssues.endpoint?.response?.historicalSummary?.itemFields
        ?.some((field) => field.name === "fields" && field.kind === "object"),
      true,
    );
    assertEquals(
      jiraSearchIssues.endpoint?.response?.historicalSummary?.itemFields
        ?.filter((field) =>
          ["summary", "status", "assignee", "created", "updated"].includes(
            field.name,
          )
        )
        .map((field) => [field.name, field.path]),
      [
        ["summary", ["fields", "summary"]],
        ["status", ["fields", "status"]],
        ["assignee", ["fields", "assignee"]],
        ["created", ["fields", "created"]],
        ["updated", ["fields", "updated"]],
      ],
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
    assertEquals(
      confluence.auth.scopes?.includes("offline_access"),
      true,
    );
    assertEquals(
      confluence.auth.scopes?.includes("read:confluence-space.summary"),
      true,
    );
    assertEquals(
      confluence.auth.scopes?.includes("read:confluence-user"),
      true,
    );
    assertEquals(
      confluence.auth.scopes?.includes("search:confluence"),
      true,
    );
    assertEquals(
      confluence.auth.scopes?.includes("read:page:confluence"),
      true,
    );
    assertEquals(
      confluence.auth.scopes?.includes("write:page:confluence"),
      true,
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
    const googleDocs = getConnector("docs-google");
    assertEquals(googleDocs.auth.scopes, [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
    assertEquals(googleDocs.setupGuide?.title, "Google Docs setup");
    assertEquals(
      googleDocs.setupGuide?.notes?.[0]?.startsWith(
        "The connection requests https://www.googleapis.com/auth/documents and https://www.googleapis.com/auth/drive.readonly.",
      ),
      true,
    );
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

  it("publishes provider-declared historical summary contracts for Confluence collection tools", () => {
    const listSites = getTool("confluence", "list_sites");
    const searchContent = getTool("confluence", "search_content");
    const listSpaces = getTool("confluence", "list_spaces");

    assertEquals(listSites.endpoint?.response?.historicalSummary, {
      collectionKeys: ["sites", "data"],
      collectionName: "sites",
      itemFields: [
        { name: "id" },
        { name: "name" },
        { name: "url" },
        { name: "scopes", kind: "string-array" },
        { name: "avatarUrl" },
      ],
      omitted: "provider-specific accessible resource payload fields",
    });
    assertEquals(searchContent.endpoint?.response?.historicalSummary, {
      collectionKeys: ["results", "content", "data"],
      collectionName: "content",
      itemFields: [
        { name: "id" },
        { name: "type" },
        { name: "status" },
        { name: "title" },
        { name: "excerpt", maxLength: 300 },
        { name: "space", kind: "object" },
        { name: "version", kind: "object" },
        { name: "_links", kind: "object" },
      ],
      outputFields: [{ name: "size" }, { name: "limit" }, { name: "start" }, {
        name: "_links",
        kind: "object",
      }],
      omitted: "page bodies, comments, and provider-specific payload fields",
    });
    assertEquals(listSpaces.endpoint?.response?.historicalSummary, {
      collectionKeys: ["results", "spaces", "data"],
      collectionName: "spaces",
      itemFields: [
        { name: "id" },
        { name: "key" },
        { name: "name" },
        { name: "type" },
        { name: "status" },
        { name: "_links", kind: "object" },
      ],
      outputFields: [{ name: "size" }, { name: "limit" }, { name: "start" }, {
        name: "_links",
        kind: "object",
      }],
      omitted: "space descriptions and provider-specific payload fields",
    });
    assertEquals(
      historicalToolSummaries["confluence__search_content"],
      searchContent.endpoint?.response?.historicalSummary,
    );
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

  it("does not accept credentialed integration hosts as tool input", () => {
    // Catalog-wide credential-forwarding invariant: an endpoint URL authority
    // must be fixed, derived from configured environment variables via
    // {{env.VAR}} placeholders, or pinned to a provider-validated OAuth origin
    // ({{oauth.raw.*}}). Tool input may at most select tenant subdomains ahead
    // of a fixed registrable domain; a placeholder that controls the
    // registrable domain would let a caller forward the connector's
    // credentials to an arbitrary host.
    for (const connector of connectors) {
      for (const tool of connector.tools) {
        const endpoint = tool.endpoint;
        if (!endpoint) continue;
        const label = `${connector.name}:${tool.id ?? tool.name}`;
        const url = endpoint.url;
        if (/^{{oauth\.raw\.[A-Za-z0-9_.-]+}}\//.test(url)) continue;
        assert(
          url.startsWith("https://"),
          `${label} must use an HTTPS endpoint URL`,
        );
        const authority = url.slice("https://".length).split("/")[0]!;
        assert(
          !authority.includes("@"),
          `${label} must not embed credentials in its URL authority`,
        );
        const withoutEnvTemplates = authority.replace(
          /{{env\.([A-Za-z0-9_]+)}}/g,
          (_match, envVarName: string) => {
            assertExists(
              connector.envVars?.find((envVar) => envVar.name === envVarName),
              `${label} must declare the ${envVarName} environment variable its URL authority uses`,
            );
            return "env-derived-host";
          },
        );
        assert(
          !withoutEnvTemplates.includes("{{"),
          `${label} uses an unsupported template in its URL authority`,
        );
        const host = withoutEnvTemplates.replace(/:\d+$/, "");
        if (!host.includes("{")) continue;
        // Tool input may only pick tenant subdomains: placeholders must be
        // whole leading labels, and the final two labels (the registrable
        // domain) must be literal.
        const hostLabels = host.split(".");
        assert(
          hostLabels.length >= 3,
          `${label} must not put tool input in control of its registrable domain (${authority})`,
        );
        for (const domainLabel of hostLabels.slice(-2)) {
          assert(
            /^[A-Za-z0-9-]+$/.test(domainLabel),
            `${label} must not put tool input in control of its registrable domain (${authority})`,
          );
        }
        for (const subdomainLabel of hostLabels.slice(0, -2)) {
          assert(
            /^(?:{[A-Za-z0-9_]+}|[A-Za-z0-9-]+)$/.test(subdomainLabel),
            `${label} must keep tool-input placeholders confined to whole subdomain labels (${authority})`,
          );
        }
      }
    }
  });

  it("masks configured hosts that may name self-hosted infrastructure", () => {
    for (
      const [connectorName, variableName] of [
        ["adyen", "ADYEN_CHECKOUT_HOST"],
        ["langfuse", "LANGFUSE_HOST"],
        ["posthog", "POSTHOG_HOST"],
        ["sap", "SAP_HOST"],
        ["servicenow", "SERVICENOW_INSTANCE"],
      ] as const
    ) {
      const envVar = getConnector(connectorName).envVars?.find(
        (candidate) => candidate.name === variableName,
      );
      assertEquals(envVar?.sensitive, true, `${variableName} must be masked in CLI output`);
    }
  });

  it("shows the QuickBooks sandbox host in scaffolded setup guidance", async () => {
    const setupMarkdown = await readTextFile(
      fromFileUrl(new URL("../../templates/integrations/_base/files/SETUP.md", import.meta.url)),
    );
    const setupHelpers = await readTextFile(
      fromFileUrl(
        new URL(
          "../../templates/integrations/_base/files/app/setup/page-helpers.tsx",
          import.meta.url,
        ),
      ),
    );

    for (const setupSurface of [setupMarkdown, setupHelpers]) {
      assertEquals(setupSurface.includes("QUICKBOOKS_API_HOST"), true);
      const configuredHosts = new Set(
        [...setupSurface.matchAll(/QUICKBOOKS_API_HOST=([A-Za-z0-9.-]+)/g)].map(
          (match) => match[1],
        ),
      );
      assertEquals(configuredHosts.has("sandbox-quickbooks.api.intuit.com"), true);
    }
  });

  it("shows regional Mixpanel hosts in scaffolded setup guidance", async () => {
    const setupMarkdown = await readTextFile(
      fromFileUrl(new URL("../../templates/integrations/_base/files/SETUP.md", import.meta.url)),
    );
    const setupHelpers = await readTextFile(
      fromFileUrl(
        new URL(
          "../../templates/integrations/_base/files/app/setup/page-helpers.tsx",
          import.meta.url,
        ),
      ),
    );

    for (const setupSurface of [setupMarkdown, setupHelpers]) {
      assertStringIncludes(setupSurface, "MIXPANEL_HOST");
      assertStringIncludes(setupSurface, "MIXPANEL_EXPORT_HOST");
    }
    assertStringIncludes(setupMarkdown, "eu.mixpanel.com");
    assertStringIncludes(setupMarkdown, "data-eu.mixpanel.com");
  });

  it("requires HTTPS termination for self-hosted Metabase and Qdrant", async () => {
    const metabaseGuide = await readTextFile(
      fromFileUrl(new URL("../../templates/integrations/metabase/connector.json", import.meta.url)),
    );
    const qdrantGuide = await readTextFile(
      fromFileUrl(new URL("../../templates/integrations/qdrant/connector.json", import.meta.url)),
    );

    assertStringIncludes(metabaseGuide, "HTTPS reverse proxy");
    assertStringIncludes(qdrantGuide, "native TLS or an HTTPS reverse proxy");
  });

  it("routes Pinecone data-plane tools through per-call hosts pinned to pinecone.io", () => {
    for (
      const [toolId, path] of [
        ["query_vectors", "/query"],
        ["upsert_vectors", "/vectors/upsert"],
      ] as const
    ) {
      const tool = getTool("pinecone", toolId);
      assertEquals(
        tool.endpoint?.url,
        `https://{indexHostPrefix}.pinecone.io${path}`,
      );
      assertEquals(tool.endpoint?.params?.indexHostPrefix?.in, "path");
      assertEquals(tool.endpoint?.params?.indexHostPrefix?.required, true);
    }

    // Per-index routing works per call; the interim single-index environment
    // variable is gone.
    const pinecone = getConnector("pinecone");
    assertEquals(
      pinecone.envVars?.some((envVar) => envVar.name === "PINECONE_INDEX_HOST"),
      false,
    );
  });

  it("routes Algolia writes to the indexing host and reads to the DSN host", () => {
    // Algolia reserves <appId>-dsn.algolia.net for distributed read traffic;
    // indexing operations must target <appId>.algolia.net.
    assertEquals(
      getTool("algolia", "save_objects").endpoint?.url,
      "https://{{env.ALGOLIA_APP_ID}}.algolia.net/1/indexes/{indexName}/batch",
    );
    for (const toolId of ["list_indices", "search_index", "browse_index", "get_object"]) {
      const url = getTool("algolia", toolId).endpoint?.url ?? "";
      assert(
        url.startsWith("https://{{env.ALGOLIA_APP_ID}}-dsn.algolia.net/"),
        `Expected algolia:${toolId} to read from the DSN host, got ${url}`,
      );
    }
  });

  it("routes DocuSign account tools through per-call hosts pinned to docusign.net", () => {
    // /oauth/userinfo pairs each account with its own base_uri, so account
    // routing must stay per call instead of collapsing onto one configured
    // host.
    const docusign = getConnector("docusign");
    assertEquals(
      docusign.envVars?.some((envVar) => envVar.name === "DOCUSIGN_ACCOUNT_HOST"),
      false,
    );
    for (const tool of docusign.tools) {
      if (!tool.endpoint) continue;
      if (tool.id === "docusign__get_user_info") {
        assertEquals(tool.endpoint.url, "https://account.docusign.com/oauth/userinfo");
        continue;
      }
      assert(
        tool.endpoint.url.startsWith("https://{accountHostPrefix}.docusign.net/restapi/v2.1/"),
        `Expected ${tool.id} to route via accountHostPrefix, got ${tool.endpoint.url}`,
      );
      assertEquals(tool.endpoint.params?.accountHostPrefix?.in, "path");
      assertEquals(tool.endpoint.params?.accountHostPrefix?.required, true);
    }
  });

  it("exposes Airtable CRUD and schema mutation endpoint tools", () => {
    const airtable = getConnector("airtable");
    const toolIds = getLocalToolIds("airtable", airtable.tools);

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
        "templates/integrations/airtable/files/tools",
      )
    ) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        toolFiles.push(entry.name.replace(/\.ts$/, ""));
      }
    }

    const expectedFiles = getLocalToolIds("airtable", airtable.tools).map((toolId) =>
      toolId?.replaceAll("_", "-")
    ).sort();
    assertEquals(toolFiles.sort(), expectedFiles);
  });

  it("documents Airtable batch and schema size constraints for agents", async () => {
    const createRecords = getTool("airtable", "create_records");
    const createTable = getTool("airtable", "create_table");
    const createRecordsTool = await Deno.readTextFile(
      "templates/integrations/airtable/files/tools/create-records.ts",
    );
    const createTableTool = await Deno.readTextFile(
      "templates/integrations/airtable/files/tools/create-table.ts",
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
        "templates/integrations/github/files/tools",
      )
    ) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        toolFiles.push(entry.name.replace(/\.ts$/, ""));
      }
    }

    const expectedFiles = github.tools.map((tool) => {
      assertExists(tool.id);
      return getConnectorLocalToolId("github", tool.id).replaceAll("_", "-");
    }).sort();
    assertEquals(toolFiles.sort(), expectedFiles);
  });

  it("keeps gmail connector tools aligned with scaffolded tool files", async () => {
    const gmail = getConnector("gmail");
    const toolFiles: string[] = [];

    for await (
      const entry of Deno.readDir(
        "templates/integrations/gmail/files/tools",
      )
    ) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        toolFiles.push(entry.name.replace(/\.ts$/, ""));
      }
    }

    const expectedFiles = gmail.tools.map((tool) => {
      assertExists(tool.id);
      return getConnectorLocalToolId("gmail", tool.id).replaceAll("_", "-");
    }).sort();
    assertEquals(toolFiles.sort(), expectedFiles);
  });

  it("ships scaffolded Outlook tool handlers required by the request-desk demo", async () => {
    const requiredToolFiles = [
      "list-threads.ts",
      "get-thread.ts",
      "create-draft.ts",
      "send-email.ts",
    ];

    for (const fileName of requiredToolFiles) {
      const source = await Deno.readTextFile(
        `templates/integrations/outlook/files/tools/${fileName}`,
      );
      assertStringIncludes(source, "tool({");
    }
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

    assertEquals(getLocalToolIds("sheets", sheets.tools), expectedToolIds);

    const toolFiles: string[] = [];
    for await (
      const entry of Deno.readDir(
        "templates/integrations/sheets/files/tools",
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
      "issues(first: $first, after: $after, states: $states",
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
    const listPrs = getTool("github", "list_prs");
    const listCommits = getTool("github", "list_commits");
    const getIssue = getTool("github", "get_issue");
    const getPr = getTool("github", "get_pr");

    assertStringIncludes(listIssues.endpoint?.query ?? "", "$after: String");
    assertStringIncludes(listIssues.endpoint?.query ?? "", "after: $after");
    assertEquals(listIssues.endpoint?.params?.after, {
      type: "string",
      in: "body",
      description: "Pagination cursor from pageInfo.endCursor",
    });
    assertEquals(listRepos.endpoint?.response?.historicalSummary?.itemFields, [
      { name: "id" },
      { name: "node_id" },
      { name: "name" },
      { name: "full_name" },
      { name: "description", maxLength: 300 },
      { name: "owner", kind: "contact" },
      { name: "html_url" },
      { name: "private" },
      { name: "visibility" },
      { name: "language" },
      { name: "stargazers_count" },
      { name: "fork" },
      { name: "archived" },
      { name: "open_issues_count" },
      { name: "default_branch" },
      { name: "updated_at" },
      { name: "pushed_at" },
    ]);
    assertEquals(listIssues.endpoint?.response?.historicalSummary?.outputFields, [
      { name: "pageInfo", kind: "object" },
    ]);
    assertEquals(
      listIssues.endpoint?.response?.historicalSummary?.itemFields.some((field) =>
        field.name === "body" && field.maxLength === 500
      ),
      true,
    );
    assertEquals(
      listIssues.endpoint?.response?.historicalSummary?.itemFields.some((field) =>
        field.name === "labels" && field.kind === "object"
      ),
      true,
    );
    assertEquals(
      listPrs.endpoint?.response?.historicalSummary?.itemFields.some((field) =>
        field.name === "body" && field.maxLength === 500
      ),
      true,
    );
    assertEquals(
      listPrs.endpoint?.response?.historicalSummary?.itemFields.some((field) =>
        field.name === "labels" && field.kind === "named-array"
      ),
      true,
    );
    assertEquals(
      listCommits.endpoint?.response?.historicalSummary?.itemFields.some((field) =>
        field.name === "commit" && field.kind === "object"
      ),
      true,
    );
    assertEquals(getIssue.endpoint?.response?.historicalSummary?.singleItem, true);
    assertEquals(getPr.endpoint?.response?.historicalSummary?.singleItem, true);
    assertEquals(
      getIssue.endpoint?.response?.historicalSummary?.itemFields.some((field) =>
        field.name === "body" && field.maxLength === 2000
      ),
      true,
    );
    assertEquals(
      getPr.endpoint?.response?.historicalSummary?.itemFields.some((field) =>
        field.name === "body" && field.maxLength === 2000
      ),
      true,
    );
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
      "Mail.Read.Shared",
      "Calendars.Read",
      "Calendars.ReadWrite",
      "offline_access",
    ]);

    assertEquals(getLocalToolIds("outlook", outlook.tools), [
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
      "list_threads",
      "get_thread",
      "list_shared_mailbox_emails",
      "search_shared_mailbox_emails",
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
      getTool("outlook", "list_threads").endpoint?.url,
      "https://graph.microsoft.com/v1.0/me/mailFolders/{folderId}/messages",
    );
    assertEquals(
      getTool("outlook", "list_threads").endpoint?.params?.["$select"]?.default,
      "id,conversationId,internetMessageId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,categories,isRead,importance,hasAttachments,webLink,flag",
    );
    assertEquals(
      getTool("outlook", "get_thread").endpoint?.url,
      "https://graph.microsoft.com/v1.0/me/messages",
    );
    assertEquals(
      getTool("outlook", "get_thread").endpoint?.params?.thread_id?.required,
      true,
    );
    assertEquals(
      getTool("outlook", "get_thread").endpoint?.params?.thread_id?.in,
      "query",
    );
    assertEquals(
      getTool("outlook", "get_thread").endpoint?.params?.thread_id?.queryName,
      "$filter",
    );
    assertEquals(
      getTool("outlook", "get_thread").endpoint?.params?.thread_id?.queryValueFormat,
      "microsoft-graph-conversation-id",
    );
    assertEquals(
      getTool("outlook", "get_thread").endpoint?.params?.filter,
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
      connectors.find((connector) => connector.name === "outlook")?.tools.some(
        (tool) => tool.id === "outlook__find_group_by_mail",
      ),
      false,
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

  it("publishes the request-desk demo connector contract for mock-to-real runs", () => {
    const demoTools = [
      ["outlook", "list_threads"],
      ["outlook", "get_thread"],
      ["outlook", "create_draft"],
      ["outlook", "send_email"],
      ["confluence", "list_sites"],
      ["confluence", "list_spaces"],
      ["confluence", "search_content"],
      ["confluence", "get_page"],
      ["confluence", "update_page"],
      ["servicenow", "list_incidents"],
      ["servicenow", "get_incident"],
      ["servicenow", "create_incident"],
      ["servicenow", "update_incident"],
      ["servicenow", "list_interactions"],
      ["servicenow", "get_interaction"],
      ["servicenow", "create_interaction"],
      ["servicenow", "update_interaction"],
      ["servicenow", "list_requests"],
      ["servicenow", "get_request"],
      ["servicenow", "create_request"],
      ["servicenow", "list_request_items"],
      ["servicenow", "get_request_item"],
      ["servicenow", "create_request_item"],
    ] as const;

    for (const [connector, toolId] of demoTools) {
      getTool(connector, toolId);
    }

    assertEquals(getTool("outlook", "create_draft").requiresWrite, true);
    assertEquals(getTool("outlook", "send_email").requiresWrite, true);
    assertEquals(getTool("confluence", "get_page").requiresWrite, false);
    assertEquals(getTool("confluence", "update_page").requiresWrite, true);
    assertEquals(getTool("servicenow", "create_incident").requiresWrite, true);
    assertEquals(getTool("servicenow", "update_incident").requiresWrite, true);
    assertEquals(
      getTool("servicenow", "list_interactions").endpoint?.url,
      "https://{{env.SERVICENOW_INSTANCE}}/api/now/v1/table/interaction",
    );
    assertEquals(getTool("servicenow", "create_interaction").requiresWrite, true);
    assertEquals(getTool("servicenow", "update_interaction").requiresWrite, true);
    assertEquals(
      getTool("servicenow", "list_requests").endpoint?.url,
      "https://{{env.SERVICENOW_INSTANCE}}/api/now/v1/table/sc_request",
    );
    assertEquals(getTool("servicenow", "create_request").requiresWrite, true);
    assertEquals(
      getTool("servicenow", "list_request_items").endpoint?.url,
      "https://{{env.SERVICENOW_INSTANCE}}/api/now/v1/table/sc_req_item",
    );
    assertEquals(getTool("servicenow", "create_request_item").requiresWrite, true);
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
          !collectionToolPattern.test(getConnectorLocalToolId(connectorName, tool.id))
        ) {
          continue;
        }

        assertExists(
          tool.endpoint.response?.historicalSummary,
          `Expected ${getNamespacedToolId(connectorName, tool.id)} to declare historicalSummary`,
        );
        assertEquals(
          historicalToolSummaries[getNamespacedToolId(connectorName, tool.id)],
          tool.endpoint.response?.historicalSummary,
        );
      }
    }
  });
});
