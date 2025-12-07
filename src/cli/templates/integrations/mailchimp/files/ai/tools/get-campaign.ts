import { tool } from "veryfront/ai";
import { z } from "zod";
import { getCampaign } from "../../lib/mailchimp-client.ts";

export default tool({
  id: "get-campaign",
  description: "Get details of a specific Mailchimp campaign by its ID.",
  inputSchema: z.object({
    campaignId: z.string().describe("The ID of the campaign to retrieve"),
  }),
  async execute({ campaignId }) {
    const campaign = await getCampaign(campaignId);

    return {
      id: campaign.id,
      webId: campaign.web_id,
      type: campaign.type,
      status: campaign.status,
      title: campaign.settings.title,
      subject: campaign.settings.subject_line,
      previewText: campaign.settings.preview_text,
      fromName: campaign.settings.from_name,
      replyTo: campaign.settings.reply_to,
      listId: campaign.recipients.list_id,
      listName: campaign.recipients.list_name,
      segmentText: campaign.recipients.segment_text,
      emailsSent: campaign.emails_sent,
      sendTime: campaign.send_time,
      createdAt: campaign.create_time,
      archiveUrl: campaign.archive_url,
      longArchiveUrl: campaign.long_archive_url,
      tracking: campaign.tracking,
      reportSummary: campaign.report_summary
        ? {
            opens: campaign.report_summary.opens,
            uniqueOpens: campaign.report_summary.unique_opens,
            openRate: campaign.report_summary.open_rate,
            clicks: campaign.report_summary.clicks,
            subscriberClicks: campaign.report_summary.subscriber_clicks,
            clickRate: campaign.report_summary.click_rate,
          }
        : undefined,
    };
  },
});
