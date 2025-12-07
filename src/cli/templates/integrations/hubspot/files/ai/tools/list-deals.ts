import { tool } from "veryfront/ai";
import { z } from "zod";
import { formatDealName, listDeals } from "../../lib/hubspot-client.ts";

export default tool({
  id: "list-deals",
  description:
    "List sales deals from your HubSpot CRM. Returns deal information including name, amount, stage, and close date.",
  inputSchema: z.object({
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of deals to return"),
    properties: z.array(z.string()).optional().describe("Additional properties to retrieve"),
  }),
  async execute({ limit, properties }) {
    const response = await listDeals({
      limit,
      properties,
    });

    return {
      deals: response.results.map((deal) => ({
        id: deal.id,
        name: formatDealName(deal),
        amount: deal.properties.amount,
        stage: deal.properties.dealstage,
        pipeline: deal.properties.pipeline,
        closeDate: deal.properties.closedate,
        createdAt: deal.createdAt,
        updatedAt: deal.updatedAt,
        additionalProperties: properties
          ? Object.fromEntries(
            properties
              .filter((prop) => deal.properties[prop] !== undefined)
              .map((prop) => [prop, deal.properties[prop]]),
          )
          : undefined,
      })),
      hasMore: !!response.paging?.next,
      nextAfter: response.paging?.next?.after,
    };
  },
});
