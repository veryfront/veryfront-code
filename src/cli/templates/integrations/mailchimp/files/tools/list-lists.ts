import { tool } from "veryfront/tool";
import { z } from "zod";
import { listLists } from "../../lib/mailchimp-client.ts";

export default tool({
  id: "list-lists",
  description: "List all audience lists (mailing lists) in Mailchimp with their statistics.",
  inputSchema: z.object({
    limit: z.number().min(1).max(50).default(20).describe("Maximum number of lists to return"),
  }),
  async execute({ limit }) {
    const lists = await listLists({ count: limit });

    return lists.map((list) => {
      const { contact, campaign_defaults: campaignDefaults, stats } = list;

      return {
        id: list.id,
        webId: list.web_id,
        name: list.name,
        dateCreated: list.date_created,
        listRating: list.list_rating,
        subscribeUrl: list.subscribe_url_short,
        contact: {
          company: contact.company,
          city: contact.city,
          state: contact.state,
          country: contact.country,
        },
        campaignDefaults: {
          fromName: campaignDefaults.from_name,
          fromEmail: campaignDefaults.from_email,
          subject: campaignDefaults.subject,
          language: campaignDefaults.language,
        },
        stats: {
          memberCount: stats.member_count,
          totalContacts: stats.total_contacts,
          unsubscribeCount: stats.unsubscribe_count,
          cleanedCount: stats.cleaned_count,
          campaignCount: stats.campaign_count,
          openRate: stats.open_rate,
          clickRate: stats.click_rate,
        },
      };
    });
  },
});
