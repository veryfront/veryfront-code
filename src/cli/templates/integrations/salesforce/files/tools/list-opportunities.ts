import { tool } from "veryfront/tool";
import { z } from "zod";
import { listOpportunities } from "../../lib/salesforce-client.ts";

export default tool({
  id: "list-opportunities",
  description:
    "List sales opportunities from your Salesforce CRM. Returns opportunity information including name, amount, stage, close date, and account association.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of opportunities to return"),
    offset: z
      .number()
      .min(0)
      .default(0)
      .describe("Number of records to skip for pagination"),
    accountId: z.string().optional().describe("Filter opportunities by Account ID"),
    fields: z
      .array(z.string())
      .optional()
      .describe("Additional fields to retrieve (e.g., Account.Name, Owner.Name, Description)"),
  }),
  async execute({ limit, offset, accountId, fields }) {
    const response = await listOpportunities({ limit, offset, accountId, fields });

    return {
      opportunities: response.records.map((opportunity) => {
        let additionalFields: Record<string, unknown> | undefined;

        if (fields) {
          additionalFields = Object.fromEntries(
            fields
              .filter((field) => opportunity[field] !== undefined)
              .map((field) => [field, opportunity[field]]),
          );
        }

        return {
          id: opportunity.Id,
          name: opportunity.Name,
          accountId: opportunity.AccountId,
          amount: opportunity.Amount,
          stageName: opportunity.StageName,
          probability: opportunity.Probability,
          closeDate: opportunity.CloseDate,
          type: opportunity.Type,
          leadSource: opportunity.LeadSource,
          isClosed: opportunity.IsClosed,
          isWon: opportunity.IsWon,
          forecastCategory: opportunity.ForecastCategory,
          createdDate: opportunity.CreatedDate,
          lastModifiedDate: opportunity.LastModifiedDate,
          additionalFields,
        };
      }),
      totalSize: response.totalSize,
      hasMore: !response.done,
    };
  },
});
