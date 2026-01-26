declare namespace _default {
    let version: number;
    let templates: {
        app: {
            files: {
                "middleware/auth.ts": string;
                "app/dashboard/page.tsx": string;
                "app/layout.tsx": string;
                "app/api/auth/logout/route.ts": string;
                "app/api/auth/register/route.ts": string;
                "app/api/auth/me/route.ts": string;
                "app/api/auth/login/route.ts": string;
                "app/api/users/route.ts": string;
                "app/api/stats/route.ts": string;
                "app/page.tsx": string;
                "app/login/page.tsx": string;
                "components/StatsGrid.tsx": string;
                "components/Toaster.tsx": string;
                "components/RecentActivity.tsx": string;
                "components/FeatureGrid.tsx": string;
                "components/DashboardLayout.tsx": string;
                "components/HeroSection.tsx": string;
                "components/Header.tsx": string;
                "components/AuthProvider.tsx": string;
                "public/robots.txt": string;
                "layout.tsx": string;
                "lib/stats.ts": string;
                "lib/users.ts": string;
                "lib/auth.ts": string;
                "lib/auth-client.ts": string;
                "api/chat/route.ts": string;
                ".env.example": string;
                "page.tsx": string;
            };
        };
        docs: {
            files: {
                "app/docs/getting-started/page.mdx": string;
                "app/docs/api/page.mdx": string;
                "app/docs/core-concepts/page.mdx": string;
                "app/layout.tsx": string;
                "app/page.mdx": string;
                "styles/globals.css": string;
                "components/Header.tsx": string;
                "components/Sidebar.tsx": string;
                "components/CodeBlock.tsx": string;
                "public/robots.txt": string;
            };
        };
        minimal: {
            files: {
                "app/about/page.mdx": string;
                "app/layout.tsx": string;
                "app/page.tsx": string;
            };
        };
        blog: {
            files: {
                "app/archive/page.tsx": string;
                "app/about/page.mdx": string;
                "app/blog/[slug]/page.tsx": string;
                "app/layout.tsx": string;
                "app/page.tsx": string;
                "content/posts/markdown-showcase.mdx": string;
                "content/posts/hello-world.mdx": string;
                "styles/globals.css": string;
                "components/BlogPostList.tsx": string;
                "components/MDXContent.tsx": string;
                "public/robots.txt": string;
                "lib/utils.ts": string;
                "lib/posts.ts": string;
            };
        };
        ai: {
            files: {
                "tools/calculator.ts": string;
                "app/layout.tsx": string;
                "app/api/chat/route.ts": string;
                "app/page.tsx": string;
                "agents/assistant.ts": string;
                "tsconfig.json": string;
            };
        };
        "integration:freshdesk": {
            files: {
                "tools/create-ticket.ts": string;
                "tools/get-ticket.ts": string;
                "tools/list-contacts.ts": string;
                "tools/update-ticket.ts": string;
                "tools/list-tickets.ts": string;
                "app/api/auth/freshdesk/route.ts": string;
                "app/api/auth/freshdesk/callback/route.ts": string;
                "lib/freshdesk-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:twitter": {
            files: {
                "tools/post-tweet.ts": string;
                "tools/search-tweets.ts": string;
                "tools/get-timeline.ts": string;
                "app/api/auth/twitter/route.ts": string;
                "app/api/auth/twitter/callback/route.ts": string;
                "lib/twitter-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:monday": {
            files: {
                "tools/list-items.ts": string;
                "tools/create-item.ts": string;
                "tools/list-boards.ts": string;
                "tools/update-item.ts": string;
                "tools/get-item.ts": string;
                "app/api/auth/monday/route.ts": string;
                "app/api/auth/monday/callback/route.ts": string;
                "lib/monday-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:box": {
            files: {
                "tools/search-files.ts": string;
                "tools/upload-file.ts": string;
                "tools/create-folder.ts": string;
                "tools/get-file.ts": string;
                "tools/list-files.ts": string;
                "app/api/auth/box/route.ts": string;
                "app/api/auth/box/callback/route.ts": string;
                "lib/box-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:discord": {
            files: {
                "tools/get-user.ts": string;
                "tools/get-messages.ts": string;
                "tools/list-channels.ts": string;
                "tools/send-message.ts": string;
                "tools/list-guilds.ts": string;
                "app/api/auth/discord/route.ts": string;
                "app/api/auth/discord/callback/route.ts": string;
                "lib/discord-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:calendar": {
            files: {
                "tools/create-event.ts": string;
                "tools/list-events.ts": string;
                "tools/find-free-time.ts": string;
                "app/api/auth/calendar/route.ts": string;
                "app/api/auth/calendar/callback/route.ts": string;
                "lib/calendar-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:sheets": {
            files: {
                "tools/create-spreadsheet.ts": string;
                "tools/get-spreadsheet.ts": string;
                "tools/read-range.ts": string;
                "tools/list-spreadsheets.ts": string;
                "tools/write-range.ts": string;
                "app/api/auth/sheets/route.ts": string;
                "app/api/auth/sheets/callback/route.ts": string;
                "lib/sheets-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:gitlab": {
            files: {
                "tools/search-issues.ts": string;
                "tools/list-merge-requests.ts": string;
                "tools/list-projects.ts": string;
                "tools/get-issue.ts": string;
                "tools/create-issue.ts": string;
                "app/api/auth/gitlab/route.ts": string;
                "app/api/auth/gitlab/callback/route.ts": string;
                "lib/gitlab-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:onedrive": {
            files: {
                "tools/search-files.ts": string;
                "tools/upload-file.ts": string;
                "tools/download-file.ts": string;
                "tools/list-files.ts": string;
                "app/api/auth/onedrive/route.ts": string;
                "app/api/auth/onedrive/callback/route.ts": string;
                "lib/onedrive-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:xero": {
            files: {
                "tools/create-invoice.ts": string;
                "tools/list-contacts.ts": string;
                "tools/list-invoices.ts": string;
                "tools/get-contact.ts": string;
                "tools/get-invoice.ts": string;
                "app/api/auth/xero/route.ts": string;
                "app/api/auth/xero/callback/route.ts": string;
                "lib/xero-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:pipedrive": {
            files: {
                "tools/create-deal.ts": string;
                "tools/update-deal.ts": string;
                "tools/list-deals.ts": string;
                "tools/get-deal.ts": string;
                "tools/list-persons.ts": string;
                "app/api/auth/pipedrive/route.ts": string;
                "app/api/auth/pipedrive/callback/route.ts": string;
                "lib/pipedrive-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:linear": {
            files: {
                "tools/search-issues.ts": string;
                "tools/list-projects.ts": string;
                "tools/get-issue.ts": string;
                "tools/update-issue.ts": string;
                "tools/create-issue.ts": string;
                "app/api/auth/linear/route.ts": string;
                "app/api/auth/linear/callback/route.ts": string;
                "lib/linear-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:intercom": {
            files: {
                "tools/list-contacts.ts": string;
                "tools/get-conversation.ts": string;
                "tools/get-contact.ts": string;
                "tools/send-message.ts": string;
                "tools/list-conversations.ts": string;
                "app/api/auth/intercom/route.ts": string;
                "app/api/auth/intercom/callback/route.ts": string;
                "lib/intercom-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:shopify": {
            files: {
                "tools/list-orders.ts": string;
                "tools/get-order.ts": string;
                "tools/list-products.ts": string;
                "tools/list-customers.ts": string;
                "tools/get-product.ts": string;
                "app/api/auth/shopify/route.ts": string;
                "app/api/auth/shopify/callback/route.ts": string;
                "lib/shopify-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:clickup": {
            files: {
                "tools/get-task.ts": string;
                "tools/update-task.ts": string;
                "tools/list-lists.ts": string;
                "tools/list-tasks.ts": string;
                "tools/create-task.ts": string;
                "app/api/auth/clickup/route.ts": string;
                "app/api/auth/clickup/callback/route.ts": string;
                "lib/clickup-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:quickbooks": {
            files: {
                "tools/create-invoice.ts": string;
                "tools/get-customer.ts": string;
                "tools/list-invoices.ts": string;
                "tools/get-invoice.ts": string;
                "tools/list-customers.ts": string;
                "app/api/auth/quickbooks/route.ts": string;
                "app/api/auth/quickbooks/callback/route.ts": string;
                "lib/quickbooks-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:mailchimp": {
            files: {
                "tools/get-campaign.ts": string;
                "tools/get-list.ts": string;
                "tools/list-campaigns.ts": string;
                "tools/list-lists.ts": string;
                "tools/list-members.ts": string;
                "app/api/auth/mailchimp/route.ts": string;
                "app/api/auth/mailchimp/callback/route.ts": string;
                "lib/mailchimp-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:snowflake": {
            files: {
                "tools/list-databases.ts": string;
                "tools/describe-table.ts": string;
                "tools/list-schemas.ts": string;
                "tools/run-query.ts": string;
                "tools/list-tables.ts": string;
                "lib/snowflake-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:docs-google": {
            files: {
                "tools/get-document.ts": string;
                "tools/list-documents.ts": string;
                "tools/update-document.ts": string;
                "tools/search-documents.ts": string;
                "tools/create-document.ts": string;
                "app/api/auth/docs-google/route.ts": string;
                "app/api/auth/docs-google/callback/route.ts": string;
                "lib/oauth.ts": string;
                "lib/docs-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:mixpanel": {
            files: {
                "tools/query-events.ts": string;
                "tools/track-event.ts": string;
                "tools/get-retention.ts": string;
                "tools/get-funnel.ts": string;
                "tools/list-cohorts.ts": string;
                "lib/mixpanel-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:notion": {
            files: {
                "tools/query-database.ts": string;
                "tools/read-page.ts": string;
                "tools/search-notion.ts": string;
                "tools/create-page.ts": string;
                "app/api/auth/notion/route.ts": string;
                "app/api/auth/notion/callback/route.ts": string;
                "lib/notion-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:supabase": {
            files: {
                "tools/update-row.ts": string;
                "tools/delete-row.ts": string;
                "tools/insert-row.ts": string;
                "tools/list-tables.ts": string;
                "tools/query-table.ts": string;
                "app/api/auth/supabase/route.ts": string;
                "lib/supabase-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:hubspot": {
            files: {
                "tools/create-contact.ts": string;
                "tools/create-deal.ts": string;
                "tools/list-contacts.ts": string;
                "tools/list-deals.ts": string;
                "tools/get-contact.ts": string;
                "app/api/auth/hubspot/route.ts": string;
                "app/api/auth/hubspot/callback/route.ts": string;
                "lib/hubspot-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:airtable": {
            files: {
                "tools/list-bases.ts": string;
                "tools/list-records.ts": string;
                "tools/get-record.ts": string;
                "tools/create-record.ts": string;
                "tools/get-base.ts": string;
                "app/api/auth/airtable/route.ts": string;
                "app/api/auth/airtable/callback/route.ts": string;
                "lib/airtable-client.ts": string;
            };
        };
        "integration:jira": {
            files: {
                "tools/search-issues.ts": string;
                "tools/list-projects.ts": string;
                "tools/get-issue.ts": string;
                "tools/update-issue.ts": string;
                "tools/create-issue.ts": string;
                "app/api/auth/jira/route.ts": string;
                "app/api/auth/jira/callback/route.ts": string;
                "lib/jira-client.ts": string;
            };
        };
        "integration:github": {
            files: {
                "tools/list-repos.ts": string;
                "tools/get-pr-diff.ts": string;
                "tools/list-prs.ts": string;
                "tools/create-issue.ts": string;
                "app/api/auth/github/route.ts": string;
                "app/api/auth/github/callback/route.ts": string;
                "lib/github-client.ts": string;
            };
        };
        "integration:figma": {
            files: {
                "tools/get-comments.ts": string;
                "tools/post-comment.ts": string;
                "tools/get-file.ts": string;
                "tools/list-projects.ts": string;
                "tools/list-files.ts": string;
                "app/api/auth/figma/route.ts": string;
                "app/api/auth/figma/callback/route.ts": string;
                "lib/figma-client.ts": string;
                "lib/types.ts": string;
                ".env.example": string;
            };
        };
        "integration:webex": {
            files: {
                "tools/list-meetings.ts": string;
                "tools/create-meeting.ts": string;
                "tools/list-rooms.ts": string;
                "tools/send-message.ts": string;
                "tools/get-meeting.ts": string;
                "app/api/auth/webex/route.ts": string;
                "app/api/auth/webex/callback/route.ts": string;
                "lib/webex-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:zendesk": {
            files: {
                "tools/create-ticket.ts": string;
                "tools/get-ticket.ts": string;
                "tools/search-tickets.ts": string;
                "tools/list-tickets.ts": string;
                "app/api/auth/zendesk/route.ts": string;
                "app/api/auth/zendesk/callback/route.ts": string;
                "lib/zendesk-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:confluence": {
            files: {
                "tools/list-spaces.ts": string;
                "tools/update-page.ts": string;
                "tools/get-page.ts": string;
                "tools/search-content.ts": string;
                "tools/create-page.ts": string;
                "app/api/auth/confluence/route.ts": string;
                "app/api/auth/confluence/callback/route.ts": string;
                "lib/confluence-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:sharepoint": {
            files: {
                "tools/list-sites.ts": string;
                "tools/upload-file.ts": string;
                "tools/get-file.ts": string;
                "tools/get-site.ts": string;
                "tools/list-files.ts": string;
                "app/api/auth/sharepoint/route.ts": string;
                "app/api/auth/sharepoint/callback/route.ts": string;
                "lib/sharepoint-client.ts": string;
            };
        };
        "integration:neon": {
            files: {
                "tools/describe-table.ts": string;
                "tools/query-database.ts": string;
                "tools/list-branches.ts": string;
                "tools/list-projects.ts": string;
                "tools/list-tables.ts": string;
                "app/api/auth/neon/route.ts": string;
                "lib/neon-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:teams": {
            files: {
                "tools/list-chats.ts": string;
                "tools/get-messages.ts": string;
                "tools/list-channels.ts": string;
                "tools/send-message.ts": string;
                "tools/list-teams.ts": string;
                "app/api/auth/teams/route.ts": string;
                "app/api/auth/teams/callback/route.ts": string;
                "lib/teams-client.ts": string;
            };
        };
        "integration:zoom": {
            files: {
                "tools/list-meetings.ts": string;
                "tools/delete-meeting.ts": string;
                "tools/create-meeting.ts": string;
                "tools/update-meeting.ts": string;
                "tools/get-meeting.ts": string;
                "app/api/auth/zoom/route.ts": string;
                "app/api/auth/zoom/callback/route.ts": string;
                "lib/zoom-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:dropbox": {
            files: {
                "tools/search-files.ts": string;
                "tools/upload-file.ts": string;
                "tools/get-file.ts": string;
                "tools/get-account.ts": string;
                "tools/list-files.ts": string;
                "app/api/auth/dropbox/route.ts": string;
                "app/api/auth/dropbox/callback/route.ts": string;
                "lib/dropbox-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:salesforce": {
            files: {
                "tools/create-lead.ts": string;
                "tools/list-accounts.ts": string;
                "tools/list-contacts.ts": string;
                "tools/get-account.ts": string;
                "tools/list-opportunities.ts": string;
                "app/api/auth/salesforce/route.ts": string;
                "app/api/auth/salesforce/callback/route.ts": string;
                "lib/salesforce-client.ts": string;
            };
        };
        "integration:anthropic": {
            files: {
                "tools/get-organization.ts": string;
                "tools/list-workspaces.ts": string;
                "tools/get-usage.ts": string;
                "tools/list-members.ts": string;
                "tools/list-api-keys.ts": string;
                "lib/anthropic-admin-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:slack": {
            files: {
                "tools/get-messages.ts": string;
                "tools/list-channels.ts": string;
                "tools/send-message.ts": string;
                "app/api/auth/slack/route.ts": string;
                "app/api/auth/slack/callback/route.ts": string;
                "lib/slack-client.ts": string;
            };
        };
        "integration:aws": {
            files: {
                "tools/list-ec2-instances.ts": string;
                "tools/list-s3-objects.ts": string;
                "tools/list-lambda-functions.ts": string;
                "tools/get-s3-object.ts": string;
                "tools/list-s3-buckets.ts": string;
                "lib/aws-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:posthog": {
            files: {
                "tools/capture-event.ts": string;
                "tools/list-feature-flags.ts": string;
                "tools/get-trends.ts": string;
                "tools/list-persons.ts": string;
                "lib/posthog-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:trello": {
            files: {
                "tools/create-card.ts": string;
                "tools/list-boards.ts": string;
                "tools/get-card.ts": string;
                "tools/update-card.ts": string;
                "tools/list-cards.ts": string;
                "app/api/auth/trello/route.ts": string;
                "app/api/auth/trello/callback/route.ts": string;
                "lib/trello-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:bitbucket": {
            files: {
                "tools/list-pull-requests.ts": string;
                "tools/list-repositories.ts": string;
                "tools/list-issues.ts": string;
                "tools/create-pull-request.ts": string;
                "app/api/auth/bitbucket/route.ts": string;
                "app/api/auth/bitbucket/callback/route.ts": string;
                "lib/bitbucket-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:servicenow": {
            files: {
                "tools/create-incident.ts": string;
                "tools/update-incident.ts": string;
                "tools/search-knowledge.ts": string;
                "tools/get-incident.ts": string;
                "tools/list-incidents.ts": string;
                "app/api/auth/servicenow/route.ts": string;
                "app/api/auth/servicenow/callback/route.ts": string;
                "lib/servicenow-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:sentry": {
            files: {
                "tools/resolve-issue.ts": string;
                "tools/list-issues.ts": string;
                "tools/list-projects.ts": string;
                "tools/get-issue.ts": string;
                "lib/sentry-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:drive": {
            files: {
                "tools/search-files.ts": string;
                "tools/upload-file.ts": string;
                "tools/create-folder.ts": string;
                "tools/get-file.ts": string;
                "tools/list-files.ts": string;
                "app/api/auth/drive/route.ts": string;
                "app/api/auth/drive/callback/route.ts": string;
                "lib/oauth.ts": string;
                "lib/drive-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:_base": {
            files: {
                "app/setup/page.tsx": string;
                "app/components/ServiceConnections.tsx": string;
                "app/api/integrations/status/route.ts": string;
                "app/api/integrations/token-storage/route.ts": string;
                "app/page.tsx": string;
                "SETUP.md": string;
                "lib/oauth.ts": string;
                "lib/token-store.ts": string;
                "lib/token-store-examples.ts": string;
            };
        };
        "integration:asana": {
            files: {
                "tools/get-task.ts": string;
                "tools/update-task.ts": string;
                "tools/list-projects.ts": string;
                "tools/list-tasks.ts": string;
                "tools/create-task.ts": string;
                "app/api/auth/asana/route.ts": string;
                "app/api/auth/asana/callback/route.ts": string;
                "lib/asana-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:gmail": {
            files: {
                "tools/list-emails.ts": string;
                "tools/search-emails.ts": string;
                "tools/send-email.ts": string;
                "app/api/auth/gmail/route.ts": string;
                "app/api/auth/gmail/callback/route.ts": string;
                "lib/gmail-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:twilio": {
            files: {
                "tools/get-message.ts": string;
                "tools/list-calls.ts": string;
                "tools/send-sms.ts": string;
                "tools/send-whatsapp.ts": string;
                "tools/list-messages.ts": string;
                "lib/twilio-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:stripe": {
            files: {
                "tools/get-customer.ts": string;
                "tools/list-subscriptions.ts": string;
                "tools/list-payments.ts": string;
                "tools/get-balance.ts": string;
                "tools/list-customers.ts": string;
                "app/api/auth/stripe/route.ts": string;
                "lib/stripe-client.ts": string;
                ".env.example": string;
            };
        };
        "integration:outlook": {
            files: {
                "tools/list-folders.ts": string;
                "tools/list-emails.ts": string;
                "tools/search-emails.ts": string;
                "tools/send-email.ts": string;
                "tools/get-email.ts": string;
                "app/api/auth/outlook/route.ts": string;
                "app/api/auth/outlook/callback/route.ts": string;
                "lib/outlook-client.ts": string;
                ".env.example": string;
            };
        };
    };
}
export default _default;
//# sourceMappingURL=manifest.d.ts.map