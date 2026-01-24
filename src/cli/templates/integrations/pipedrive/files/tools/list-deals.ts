import { tool } from "veryfront/tool";
import { z } from "zod";
import { listDeals } from "../../lib/pipedrive-client.ts";

export default tool({
  id: "list-deals",
  description:
    "List deals from Pipedrive. Can filter by status, owner, or stage to get specific deals in the sales pipeline.",
  inputSchema: z.object({
    status: z
      .enum(["open", "won", "lost", "all"])
      .default("open")
      .describe("Filter deals by status"),
    ownerId: z.number().optional().describe("Filter deals by owner user ID"),
    stageId: z.number().optional().describe("Filter deals by stage ID"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of deals to return"),
  }),
  async execute({ status, ownerId, stageId, limit }) {
    const deals = await listDeals({ status, ownerId, stageId, limit });

    return deals.map(
      ({
        id,
        title,
        value,
        currency,
        status,
        stage_id,
        person_name,
        org_name,
        owner_name,
        expected_close_date,
        add_time,
        update_time,
      }) => ({
        id,
        title,
        value,
        currency,
        status,
        stageId: stage_id,
        personName: person_name,
        orgName: org_name,
        ownerName: owner_name,
        expectedCloseDate: expected_close_date,
        addTime: add_time,
        updateTime: update_time,
      }),
    );
  },
});
