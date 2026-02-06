import { tool } from "veryfront/tool";
import { z } from "zod";
import { createDeal, formatDealName } from "../../lib/hubspot-client.ts";

export default tool({
  id: "create-deal",
  description:
    "Create a new deal in HubSpot CRM. Deal name is required, other fields are optional.",
  inputSchema: z.object({
    dealname: z.string().describe("Deal name (required)"),
    amount: z.string().optional().describe("Deal amount in the account currency"),
    dealstage: z
      .string()
      .optional()
      .describe(
        'Current stage of the deal (e.g., "appointmentscheduled", "qualifiedtobuy", "closedwon")',
      ),
    pipeline: z.string().optional().describe("Pipeline ID for the deal"),
    closedate: z
      .string()
      .optional()
      .describe("Expected close date in format YYYY-MM-DD or timestamp"),
  }),
  async execute({ dealname, amount, dealstage, pipeline, closedate }) {
    const properties: Record<string, string> = { dealname };

    if (amount) properties.amount = amount;
    if (dealstage) properties.dealstage = dealstage;
    if (pipeline) properties.pipeline = pipeline;
    if (closedate) properties.closedate = closedate;

    const deal = await createDeal(properties);
    const name = formatDealName(deal);

    return {
      id: deal.id,
      name,
      amount: deal.properties.amount,
      stage: deal.properties.dealstage,
      pipeline: deal.properties.pipeline,
      closeDate: deal.properties.closedate,
      createdAt: deal.createdAt,
      message: `Successfully created deal: ${name}`,
    };
  },
});
