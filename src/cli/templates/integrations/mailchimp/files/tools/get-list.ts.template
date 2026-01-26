import { tool } from "veryfront/tool";
import { z } from "zod";
import { getList } from "../../lib/mailchimp-client.ts";

export default tool({
  id: "get-list",
  description: "Get details of a specific Mailchimp audience list by its ID.",
  inputSchema: z.object({
    listId: z.string().describe("The ID of the audience list to retrieve"),
  }),
  async execute({ listId }) {
    const list = await getList(listId);
    const { contact, campaign_defaults, stats } = list;

    return {
      id: list.id,
      webId: list.web_id,
      name: list.name,
      dateCreated: list.date_created,
      listRating: list.list_rating,
      permissionReminder: list.permission_reminder,
      subscribeUrlShort: list.subscribe_url_short,
      subscribeUrlLong: list.subscribe_url_long,
      contact: {
        company: contact.company,
        address1: contact.address1,
        city: contact.city,
        state: contact.state,
        zip: contact.zip,
        country: contact.country,
      },
      campaignDefaults: {
        fromName: campaign_defaults.from_name,
        fromEmail: campaign_defaults.from_email,
        subject: campaign_defaults.subject,
        language: campaign_defaults.language,
      },
      stats: {
        memberCount: stats.member_count,
        totalContacts: stats.total_contacts,
        unsubscribeCount: stats.unsubscribe_count,
        cleanedCount: stats.cleaned_count,
        memberCountSinceSend: stats.member_count_since_send,
        unsubscribeCountSinceSend: stats.unsubscribe_count_since_send,
        cleanedCountSinceSend: stats.cleaned_count_since_send,
        campaignCount: stats.campaign_count,
        openRate: stats.open_rate,
        clickRate: stats.click_rate,
      },
    };
  },
});
