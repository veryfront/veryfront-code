import { tool } from "veryfront/tool";
import { z } from "zod";
import { updateDeal } from "../../lib/pipedrive-client.ts";

export default tool({
  id: "update-deal",
  description: "Update an existing deal in Pipedrive with new information.",
  inputSchema: z.object({
    dealId: z.number().describe("The ID of the deal to update"),
    title: z.string().optional().describe("New title/name for the deal"),
    value: z.number().optional().describe("New monetary value for the deal"),
    status: z.string().optional().describe("New status (e.g., open, won, lost)"),
    stageId: z.number().optional().describe("New pipeline stage ID"),
    personId: z.number().optional().describe("New person/contact ID"),
    orgId: z.number().optional().describe("New organization ID"),
    expectedCloseDate: z
      .string()
      .optional()
      .describe("New expected close date in YYYY-MM-DD format"),
  }),
  async execute(input) {
    const deal = await updateDeal(input.dealId, {
      title: input.title,
      value: input.value,
      status: input.status,
      stageId: input.stageId,
      personId: input.personId,
      orgId: input.orgId,
      expectedCloseDate: input.expectedCloseDate,
    });

    return {
      success: true,
      deal: {
        id: deal.id,
        title: deal.title,
        value: deal.value,
        status: deal.status,
        stageId: deal.stage_id,
        personName: deal.person_name,
        orgName: deal.org_name,
        expectedCloseDate: deal.expected_close_date,
        updateTime: deal.update_time,
      },
    };
  },
});
