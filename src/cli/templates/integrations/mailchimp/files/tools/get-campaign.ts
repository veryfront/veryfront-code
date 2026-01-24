import { tool } from "veryfront/tool";
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
    const reportSummary = campaign.report_summary;

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
      reportSummary: reportSummary
        ? {
            opens: reportSummary.opens,
            uniqueOpens: reportSummary.unique_opens,
            openRate: reportSummary.open_rate,
            clicks: reportSummary.clicks,
            subscriberClicks: reportSummary.subscriber_clicks,
            clickRate: reportSummary.click_rate,
          }
        : undefined,
    };
  },
});
