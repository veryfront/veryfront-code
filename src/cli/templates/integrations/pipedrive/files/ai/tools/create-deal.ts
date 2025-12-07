import { tool } from "veryfront/ai";
import { z } from "zod";
import { createDeal } from "../../lib/pipedrive-client.ts";

export default tool({
  id: "create-deal",
  description: "Create a new deal in the Pipedrive sales pipeline.",
  inputSchema: z.object({
    title: z.string().describe("The title/name of the deal"),
    value: z.number().optional().describe("The monetary value of the deal"),
    currency: z.string().default("USD").describe("Currency code (e.g., USD, EUR, GBP)"),
    personId: z.number().optional().describe("ID of the person/contact associated with the deal"),
    orgId: z.number().optional().describe("ID of the organization associated with the deal"),
    stageId: z.number().optional().describe("ID of the pipeline stage for the deal"),
    expectedCloseDate: z.string().optional().describe(
      "Expected close date in YYYY-MM-DD format",
    ),
  }),
  async execute({ title, value, currency, personId, orgId, stageId, expectedCloseDate }) {
    const deal = await createDeal({
      title,
      value,
      currency,
      personId,
      orgId,
      stageId,
      expectedCloseDate,
    });

    return {
      success: true,
      deal: {
        id: deal.id,
        title: deal.title,
        value: deal.value,
        currency: deal.currency,
        stageId: deal.stage_id,
        personName: deal.person_name,
        orgName: deal.org_name,
        expectedCloseDate: deal.expected_close_date,
      },
    };
  },
});
