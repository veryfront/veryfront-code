import { tool } from "veryfront/ai";
import { z } from "zod";
import { listDeals } from "../../lib/pipedrive-client.ts";

export default tool({
  id: "list-deals",
  description:
    "List deals from Pipedrive. Can filter by status, owner, or stage to get specific deals in the sales pipeline.",
  inputSchema: z.object({
    status: z.enum(["open", "won", "lost", "all"]).default("open").describe(
      "Filter deals by status",
    ),
    ownerId: z.number().optional().describe("Filter deals by owner user ID"),
    stageId: z.number().optional().describe("Filter deals by stage ID"),
    limit: z.number().min(1).max(100).default(20).describe("Maximum number of deals to return"),
  }),
  async execute({ status, ownerId, stageId, limit }) {
    const deals = await listDeals({
      status,
      ownerId,
      stageId,
      limit,
    });

    return deals.map((deal) => ({
      id: deal.id,
      title: deal.title,
      value: deal.value,
      currency: deal.currency,
      status: deal.status,
      stageId: deal.stage_id,
      personName: deal.person_name,
      orgName: deal.org_name,
      ownerName: deal.owner_name,
      expectedCloseDate: deal.expected_close_date,
      addTime: deal.add_time,
      updateTime: deal.update_time,
    }));
  },
});
