import { tool } from "veryfront/tool";
import { z } from "zod";
import { getDeal } from "../../lib/pipedrive-client.ts";

export default tool({
  id: "get-deal",
  description: "Get detailed information about a specific deal in Pipedrive by its ID.",
  inputSchema: z.object({
    dealId: z.number().describe("The ID of the deal to retrieve"),
  }),
  async execute({ dealId }) {
    const deal = await getDeal(dealId);

    return {
      id: deal.id,
      title: deal.title,
      value: deal.value,
      currency: deal.currency,
      status: deal.status,
      stageId: deal.stage_id,
      personId: deal.person_id,
      personName: deal.person_name,
      orgId: deal.org_id,
      orgName: deal.org_name,
      ownerName: deal.owner_name,
      expectedCloseDate: deal.expected_close_date,
      addTime: deal.add_time,
      updateTime: deal.update_time,
      wonTime: deal.won_time,
      lostTime: deal.lost_time,
      closeTime: deal.close_time,
    };
  },
});
