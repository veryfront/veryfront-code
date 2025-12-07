import { tool } from "veryfront/ai";
import { z } from "zod";
import { listLists } from "../../lib/mailchimp-client.ts";

export default tool({
  id: "list-lists",
  description: "List all audience lists (mailing lists) in Mailchimp with their statistics.",
  inputSchema: z.object({
    limit: z.number().min(1).max(50).default(20).describe("Maximum number of lists to return"),
  }),
  async execute({ limit }) {
    const lists = await listLists({
      count: limit,
    });

    return lists.map((list) => ({
      id: list.id,
      webId: list.web_id,
      name: list.name,
      dateCreated: list.date_created,
      listRating: list.list_rating,
      subscribeUrl: list.subscribe_url_short,
      contact: {
        company: list.contact.company,
        city: list.contact.city,
        state: list.contact.state,
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
        campaignCount: list.stats.campaign_count,
        openRate: list.stats.open_rate,
        clickRate: list.stats.click_rate,
      },
    }));
  },
});
