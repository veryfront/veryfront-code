import { tool } from "veryfront/tool";
import { z } from "zod";
import { listMembers } from "../../lib/mailchimp-client.ts";

export default tool({
  id: "list-members",
  description:
    "List subscribers/members in a Mailchimp audience list. Can filter by subscription status.",
  inputSchema: z.object({
    listId: z.string().describe("The ID of the audience list to get members from"),
    status: z
      .enum(["subscribed", "unsubscribed", "cleaned", "pending", "transactional"])
      .optional()
      .describe("Filter members by subscription status"),
    limit: z.number().min(1).max(50).default(20).describe("Maximum number of members to return"),
  }),
  async execute({ listId, status, limit }) {
    const members = await listMembers(listId, { status, count: limit });

    return members.map((member) => ({
      id: member.id,
      emailAddress: member.email_address,
      uniqueEmailId: member.unique_email_id,
      contactId: member.contact_id,
      fullName: member.full_name,
      status: member.status,
      emailType: member.email_type,
      vip: member.vip,
      language: member.language,
      memberRating: member.member_rating,
      lastChanged: member.last_changed,
      timestampSignup: member.timestamp_signup,
      timestampOpt: member.timestamp_opt,
      ipSignup: member.ip_signup,
      ipOpt: member.ip_opt,
      stats: {
        avgOpenRate: member.stats.avg_open_rate,
        avgClickRate: member.stats.avg_click_rate,
      },
      mergeFields: member.merge_fields,
      tags: member.tags.map(({ id, name }) => ({ id, name })),
      location: member.location
        ? {
            countryCode: member.location.country_code,
            timezone: member.location.timezone,
            latitude: member.location.latitude,
            longitude: member.location.longitude,
          }
        : undefined,
    }));
  },
});
