import { tool } from "veryfront/ai";
import { z } from "zod";
import { listCampaigns } from "../../lib/mailchimp-client.ts";

export default tool({
  id: "list-campaigns",
  description:
    "List email campaigns from Mailchimp. Can filter by status (save, paused, schedule, sending, sent).",
  inputSchema: z.object({
    status: z
      .enum(["save", "paused", "schedule", "sending", "sent"])
      .optional()
      .describe("Filter campaigns by status"),
    limit: z.number().min(1).max(50).default(20).describe("Maximum number of campaigns to return"),
  }),
  async execute({ status, limit }) {
    const campaigns = await listCampaigns({
      status,
      count: limit,
    });

    return campaigns.map((campaign) => ({
      id: campaign.id,
      webId: campaign.web_id,
      type: campaign.type,
      status: campaign.status,
      title: campaign.settings.title,
      subject: campaign.settings.subject_line,
      fromName: campaign.settings.from_name,
      listName: campaign.recipients.list_name,
      emailsSent: campaign.emails_sent,
      sendTime: campaign.send_time,
      createdAt: campaign.create_time,
      archiveUrl: campaign.archive_url,
      reportSummary: campaign.report_summary
        ? {
            opens: campaign.report_summary.opens,
            uniqueOpens: campaign.report_summary.unique_opens,
            openRate: campaign.report_summary.open_rate,
            clicks: campaign.report_summary.clicks,
            clickRate: campaign.report_summary.click_rate,
          }
        : undefined,
    }));
  },
});
