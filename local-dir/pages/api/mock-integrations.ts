export default async function handler({ req }) {
  return [
    {
      name: "airtable",
      displayName: "Airtable",
      icon: "/api/integrations/airtable/icon",
      description: "Read and write records in Airtable bases and tables",
    },
    {
      name: "anthropic",
      displayName: "Anthropic",
      icon: "/api/integrations/anthropic/icon",
      description:
        "Integrate with Anthropic Admin API to manage workspaces, monitor usage, and access organization data",
    },
    {
      name: "asana",
      displayName: "Asana",
      icon: "/api/integrations/asana/icon",
      description: "Manage tasks, projects, and teams in Asana",
    },
    {
      name: "aws",
      displayName: "Amazon Web Services",
      icon: "/api/integrations/aws/icon",
      description:
        "Integration with AWS services including S3, EC2, and Lambda",
    },
    {
      name: "bitbucket",
      displayName: "Bitbucket",
      icon: "/api/integrations/bitbucket/icon",
      description:
        "Manage repositories, pull requests, and issues on Bitbucket",
    },
    {
      name: "box",
      displayName: "Box",
      icon: "/api/integrations/box/icon",
      description: "Access and manage files, folders, and content in Box",
    },
    {
      name: "calendar",
      displayName: "Google Calendar",
      icon: "/api/integrations/calendar/icon",
      description: "Manage events, find free time, and schedule meetings",
    },
    {
      name: "clickup",
      displayName: "ClickUp",
      icon: "/api/integrations/clickup/icon",
      description: "Manage tasks, lists, and projects in ClickUp",
    },
    {
      name: "confluence",
      displayName: "Confluence",
      icon: "/api/integrations/confluence/icon",
      description: "Search, read, and create documentation in Confluence",
    },
    {
      name: "discord",
      displayName: "Discord",
      icon: "/api/integrations/discord/icon",
      description:
        "Read messages, send messages, and interact with Discord servers",
    },
    {
      name: "docs-google",
      displayName: "Google Docs",
      icon: "/api/integrations/docs-google/icon",
      description: "Read, create, and manage Google Docs documents",
    },
    {
      name: "drive",
      displayName: "Google Drive",
      icon: "/api/integrations/drive/icon",
      description:
        "Access, search, and manage files and folders in Google Drive",
    },
    {
      name: "dropbox",
      displayName: "Dropbox",
      icon: "/api/integrations/dropbox/icon",
      description: "Access, search, and manage files in your Dropbox storage",
    },
    {
      name: "figma",
      displayName: "Figma",
      icon: "/api/integrations/figma/icon",
      description:
        "Access Figma designs, files, comments, and collaborate on design projects",
    },
    {
      name: "freshdesk",
      displayName: "Freshdesk",
      icon: "/api/integrations/freshdesk/icon",
      description: "Manage customer support tickets and contacts in Freshdesk",
    },
    {
      name: "github",
      displayName: "GitHub",
      icon: "/api/integrations/github/icon",
      description: "Manage repositories, issues, and pull requests",
    },
    {
      name: "gitlab",
      displayName: "GitLab",
      icon: "/api/integrations/gitlab/icon",
      description:
        "Search and manage GitLab issues, merge requests, and projects",
    },
    {
      name: "gmail",
      displayName: "Gmail",
      icon: "/api/integrations/gmail/icon",
      description: "Read and send emails via Gmail API",
    },
    {
      name: "hubspot",
      displayName: "HubSpot",
      icon: "/api/integrations/hubspot/icon",
      description: "Manage contacts, companies, and deals in your HubSpot CRM",
    },
    {
      name: "intercom",
      displayName: "Intercom",
      icon: "/api/integrations/intercom/icon",
      description: "Customer messaging platform for support and engagement",
    },
    {
      name: "jira",
      displayName: "Jira",
      icon: "/api/integrations/jira/icon",
      description: "Search, create, and manage Jira issues and projects",
    },
    {
      name: "linear",
      displayName: "Linear",
      icon: "/api/integrations/linear/icon",
      description: "Search, create, and manage Linear issues and projects",
    },
    {
      name: "mailchimp",
      displayName: "Mailchimp",
      icon: "/api/integrations/mailchimp/icon",
      description:
        "Manage email campaigns, lists, and subscribers in Mailchimp",
    },
    {
      name: "mixpanel",
      displayName: "Mixpanel",
      icon: "/api/integrations/mixpanel/icon",
      description:
        "Track events, analyze funnels, and understand user behavior with Mixpanel analytics",
    },
    {
      name: "monday",
      displayName: "Monday.com",
      icon: "/api/integrations/monday/icon",
      description: "Manage projects, tasks, and workflows in Monday.com",
    },
    {
      name: "neon",
      displayName: "Neon",
      icon: "/api/integrations/neon/icon",
      description:
        "Manage Neon Postgres projects, branches, and execute database queries",
    },
    {
      name: "notion",
      displayName: "Notion",
      icon: "/api/integrations/notion/icon",
      description: "Search, read, and create pages in Notion workspaces",
    },
    {
      name: "onedrive",
      displayName: "OneDrive",
      icon: "/api/integrations/onedrive/icon",
      description: "Access and manage files in Microsoft OneDrive",
    },
    {
      name: "outlook",
      displayName: "Microsoft Outlook",
      icon: "/api/integrations/outlook/icon",
      description: "Read, send, and manage Outlook emails",
    },
    {
      name: "pipedrive",
      displayName: "Pipedrive",
      icon: "/api/integrations/pipedrive/icon",
      description: "Manage deals, contacts, and sales pipeline in Pipedrive",
    },
    {
      name: "posthog",
      displayName: "PostHog",
      icon: "/api/integrations/posthog/icon",
      description:
        "Access analytics, feature flags, and user insights from PostHog",
    },
    {
      name: "quickbooks",
      displayName: "QuickBooks",
      icon: "/api/integrations/quickbooks/icon",
      description: "Manage invoices, customers, and accounting in QuickBooks",
    },
    {
      name: "salesforce",
      displayName: "Salesforce",
      icon: "/api/integrations/salesforce/icon",
      description:
        "Manage accounts, contacts, opportunities, and leads in your Salesforce CRM",
    },
    {
      name: "sentry",
      displayName: "Sentry",
      icon: "/api/integrations/sentry/icon",
      description: "Monitor errors, track issues, and manage Sentry projects",
    },
    {
      name: "servicenow",
      displayName: "ServiceNow",
      icon: "/api/integrations/servicenow/icon",
      description:
        "IT Service Management - incidents, changes, and service requests",
    },
    {
      name: "sharepoint",
      displayName: "SharePoint",
      icon: "/api/integrations/sharepoint/icon",
      description:
        "Access and manage SharePoint sites, document libraries, and files",
    },
    {
      name: "sheets",
      displayName: "Google Sheets",
      icon: "/api/integrations/sheets/icon",
      description: "Read, write, and manage Google Sheets spreadsheets",
    },
    {
      name: "shopify",
      displayName: "Shopify",
      icon: "/api/integrations/shopify/icon",
      description:
        "Manage products, orders, and customers in your Shopify store",
    },
    {
      name: "slack",
      displayName: "Slack",
      icon: "/api/integrations/slack/icon",
      description: "Send messages, read channels, and manage Slack workspace",
    },
    {
      name: "snowflake",
      displayName: "Snowflake",
      icon: "/api/integrations/snowflake/icon",
      description:
        "Query and manage your Snowflake data warehouse with SQL operations across databases, schemas, and tables",
    },
    {
      name: "stripe",
      displayName: "Stripe",
      icon: "/api/integrations/stripe/icon",
      description:
        "Access Stripe payment data, customers, subscriptions, and balance information",
    },
    {
      name: "supabase",
      displayName: "Supabase",
      icon: "/api/integrations/supabase/icon",
      description:
        "Query and manage your Supabase database with full CRUD operations",
    },
    {
      name: "teams",
      displayName: "Microsoft Teams",
      icon: "/api/integrations/teams/icon",
      description: "Send messages and manage Teams chats and channels",
    },
    {
      name: "trello",
      displayName: "Trello",
      icon: "/api/integrations/trello/icon",
      description: "Manage boards, lists, and cards in Trello",
    },
    {
      name: "twilio",
      displayName: "Twilio",
      icon: "/api/integrations/twilio/icon",
      description:
        "Send SMS, WhatsApp messages, make calls, and manage communications with Twilio",
    },
    {
      name: "twitter",
      displayName: "Twitter / X",
      icon: "/api/integrations/twitter/icon",
      description:
        "Post tweets, read timeline, search tweets, and manage Twitter account",
    },
    {
      name: "webex",
      displayName: "Webex",
      icon: "/api/integrations/webex/icon",
      description: "Manage meetings, rooms, and messages in Webex",
    },
    {
      name: "xero",
      displayName: "Xero",
      icon: "/api/integrations/xero/icon",
      description: "Manage invoices, contacts, and accounting data in Xero",
    },
    {
      name: "zendesk",
      displayName: "Zendesk",
      icon: "/api/integrations/zendesk/icon",
      description: "Manage support tickets, users, and help center content",
    },
    {
      name: "zoom",
      displayName: "Zoom",
      icon: "/api/integrations/zoom/icon",
      description: "Manage video meetings and webinars in Zoom",
    },
  ]
}
