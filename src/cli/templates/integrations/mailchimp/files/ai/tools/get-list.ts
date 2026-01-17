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
        company: list.contact.company,
        address1: list.contact.address1,
        city: list.contact.city,
        state: list.contact.state,
        zip: list.contact.zip,
        country: list.contact.country,
      },
      campaignDefaults: {
        fromName: list.campaign_defaults.from_name,
        fromEmail: list.campaign_defaults.from_email,
        subject: list.campaign_defaults.subject,
        language: list.campaign_defaults.language,
      },
      stats: {
        memberCount: list.stats.member_count,
        totalContacts: list.stats.total_contacts,
        unsubscribeCount: list.stats.unsubscribe_count,
        cleanedCount: list.stats.cleaned_count,
        memberCountSinceSend: list.stats.member_count_since_send,
        unsubscribeCountSinceSend: list.stats.unsubscribe_count_since_send,
        cleanedCountSinceSend: list.stats.cleaned_count_since_send,
        campaignCount: list.stats.campaign_count,
        openRate: list.stats.open_rate,
        clickRate: list.stats.click_rate,
      },
    };
  },
});
