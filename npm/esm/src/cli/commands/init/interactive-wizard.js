import { cyan, dim, green } from "../../../platform/compat/console/index.js";
import { isCiEnv, isDenoTestingEnv } from "../../../config/env.js";
import { isInteractive as checkIsInteractive } from "../../../platform/compat/process.js";
import { cliLogger as logger } from "../../../utils/index.js";
import { multiSelect, select } from "../../utils/terminal-select.js";
const TEMPLATES = [
    { value: "ai", label: "AI Agent", description: "AI-powered agent with service integrations" },
    { value: "app", label: "Full App", description: "Complete app with auth and dashboard" },
    { value: "blog", label: "Blog", description: "Blog with MDX posts" },
    { value: "docs", label: "Docs", description: "Documentation site" },
    { value: "minimal", label: "Minimal", description: "Simple starting point" },
];
const INTEGRATION_CATEGORIES = [
    {
        name: "Communication",
        integrations: [
            { value: "gmail", label: "Gmail", description: "Read, search, send emails" },
            { value: "slack", label: "Slack", description: "Messages, channels, search" },
            { value: "outlook", label: "Outlook", description: "Email via Microsoft Graph" },
            { value: "teams", label: "Teams", description: "Chat, meetings" },
            { value: "discord", label: "Discord", description: "Messages, server management" },
            { value: "webex", label: "Webex", description: "Messaging, meetings" },
            { value: "zoom", label: "Zoom", description: "Meetings, webinars" },
            { value: "twilio", label: "Twilio", description: "SMS, voice" },
        ],
    },
    {
        name: "Productivity",
        integrations: [
            { value: "calendar", label: "Calendar", description: "Google Calendar events" },
            { value: "notion", label: "Notion", description: "Pages, databases, blocks" },
            { value: "jira", label: "Jira", description: "Issues, projects, sprints" },
            { value: "linear", label: "Linear", description: "Issue tracking" },
            { value: "asana", label: "Asana", description: "Tasks, projects" },
            { value: "trello", label: "Trello", description: "Boards, lists, cards" },
            { value: "monday", label: "Monday", description: "Work management" },
            { value: "clickup", label: "ClickUp", description: "Tasks, docs" },
            { value: "confluence", label: "Confluence", description: "Wiki pages, spaces" },
        ],
    },
    {
        name: "Development",
        integrations: [
            { value: "github", label: "GitHub", description: "Repos, issues, PRs, actions" },
            { value: "gitlab", label: "GitLab", description: "Repos, merge requests, pipelines" },
            { value: "bitbucket", label: "Bitbucket", description: "Repos, pull requests" },
            { value: "sentry", label: "Sentry", description: "Error tracking" },
            { value: "posthog", label: "PostHog", description: "Product analytics" },
            { value: "mixpanel", label: "Mixpanel", description: "Analytics, events" },
        ],
    },
    {
        name: "Storage",
        integrations: [
            { value: "drive", label: "Google Drive", description: "Files, folders" },
            { value: "docs-google", label: "Google Docs", description: "Documents" },
            { value: "sheets", label: "Google Sheets", description: "Spreadsheets" },
            { value: "onedrive", label: "OneDrive", description: "Microsoft files" },
            { value: "sharepoint", label: "SharePoint", description: "Enterprise content" },
            { value: "dropbox", label: "Dropbox", description: "File storage" },
            { value: "box", label: "Box", description: "Enterprise files" },
            { value: "airtable", label: "Airtable", description: "Database, spreadsheet" },
        ],
    },
    {
        name: "Infrastructure",
        integrations: [
            { value: "supabase", label: "Supabase", description: "Postgres, auth, storage" },
            { value: "neon", label: "Neon", description: "Serverless Postgres" },
            { value: "snowflake", label: "Snowflake", description: "Data warehouse" },
            { value: "aws", label: "AWS", description: "S3, Lambda, DynamoDB" },
        ],
    },
    {
        name: "Sales & CRM",
        integrations: [
            { value: "salesforce", label: "Salesforce", description: "CRM, sales automation" },
            { value: "hubspot", label: "HubSpot", description: "Marketing, sales" },
            { value: "pipedrive", label: "Pipedrive", description: "Sales pipeline" },
        ],
    },
    {
        name: "Support",
        integrations: [
            { value: "zendesk", label: "Zendesk", description: "Tickets, support" },
            { value: "intercom", label: "Intercom", description: "Customer messaging" },
            { value: "freshdesk", label: "Freshdesk", description: "Help desk" },
            { value: "servicenow", label: "ServiceNow", description: "IT service management" },
        ],
    },
    {
        name: "Finance",
        integrations: [
            { value: "stripe", label: "Stripe", description: "Payments, subscriptions" },
            { value: "quickbooks", label: "QuickBooks", description: "Accounting" },
            { value: "xero", label: "Xero", description: "Accounting" },
        ],
    },
    {
        name: "Marketing",
        integrations: [
            { value: "mailchimp", label: "Mailchimp", description: "Email marketing" },
            { value: "shopify", label: "Shopify", description: "E-commerce" },
            { value: "twitter", label: "Twitter/X", description: "Social media" },
        ],
    },
    {
        name: "Design",
        integrations: [{ value: "figma", label: "Figma", description: "Design files, comments" }],
    },
    {
        name: "AI Providers",
        integrations: [{ value: "anthropic", label: "Anthropic", description: "Claude models" }],
    },
];
function getIntegrationChoices() {
    const choices = [];
    for (const category of INTEGRATION_CATEGORIES) {
        choices.push({
            value: `__header_${category.name}`,
            label: `── ${category.name} ──`,
            description: "",
            isHeader: true,
        });
        choices.push(...category.integrations);
    }
    return choices;
}
function canRunWizard() {
    return !(isCiEnv() || isDenoTestingEnv()) && checkIsInteractive();
}
export async function runInteractiveWizard() {
    if (!canRunWizard()) {
        return { template: "minimal", integrations: [], skipped: true };
    }
    console.log("");
    console.log(green("Welcome to Veryfront!"));
    console.log("Let's set up your project.");
    const templateChoice = await select("What would you like to build?", [...TEMPLATES], 0);
    if (!templateChoice) {
        logger.warn("No template selected, using minimal");
        return { template: "minimal", integrations: [], skipped: false };
    }
    const template = templateChoice;
    if (template !== "ai") {
        const templateLabel = TEMPLATES.find((t) => t.value === template)?.label ?? template;
        console.log("");
        console.log(green("Got it!") + ` Creating a ${templateLabel} project.`);
        return { template, integrations: [], skipped: false };
    }
    console.log("");
    console.log(dim("Use arrow keys to navigate, space to select, enter to confirm"));
    console.log(dim("Popular choices: Gmail, Slack, GitHub, Calendar, Notion"));
    console.log("");
    const selected = await multiSelect("Which services should your agent connect to?", getIntegrationChoices().filter((c) => !c.isHeader));
    const integrations = selected;
    console.log("");
    console.log(green("Perfect!") + " Here's what we'll create:");
    console.log("");
    console.log(`  ${cyan("Template:")} AI Agent`);
    if (integrations.length > 0) {
        console.log(`  ${cyan("Integrations:")} ${integrations.join(", ")}`);
    }
    else {
        console.log(dim("  No integrations selected (you can add them later)"));
    }
    console.log("");
    return { template: "ai", integrations, skipped: false };
}
export function shouldRunWizard(options) {
    return !options.template && (options.integrations?.length ?? 0) === 0;
}
