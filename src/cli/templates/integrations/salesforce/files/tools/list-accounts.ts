import { tool } from "veryfront/tool";
import { z } from "zod";
import { listAccounts } from "../../lib/salesforce-client.ts";

export default tool({
  id: "list-accounts",
  description:
    "List accounts from your Salesforce CRM. Returns account information including name, type, industry, website, and billing details.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of accounts to return"),
    offset: z
      .number()
      .min(0)
      .default(0)
      .describe("Number of records to skip for pagination"),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        "Additional fields to retrieve (e.g., Description, Owner.Name, ParentId)",
      ),
  }),
  async execute({ limit, offset, fields }) {
    const response = await listAccounts({ limit, offset, fields });

    return {
      accounts: response.records.map((account) => {
        if (!fields?.length) {
          return {
            id: account.Id,
            name: account.Name,
            type: account.Type,
            industry: account.Industry,
            website: account.Website,
            phone: account.Phone,
            billingCity: account.BillingCity,
            billingState: account.BillingState,
            billingCountry: account.BillingCountry,
            numberOfEmployees: account.NumberOfEmployees,
            annualRevenue: account.AnnualRevenue,
            createdDate: account.CreatedDate,
            lastModifiedDate: account.LastModifiedDate,
            additionalFields: undefined,
          };
        }

        const additionalFields = Object.fromEntries(
          fields
            .filter((field) => account[field] !== undefined)
            .map((field) => [field, account[field]]),
        );

        return {
          id: account.Id,
          name: account.Name,
          type: account.Type,
          industry: account.Industry,
          website: account.Website,
          phone: account.Phone,
          billingCity: account.BillingCity,
          billingState: account.BillingState,
          billingCountry: account.BillingCountry,
          numberOfEmployees: account.NumberOfEmployees,
          annualRevenue: account.AnnualRevenue,
          createdDate: account.CreatedDate,
          lastModifiedDate: account.LastModifiedDate,
          additionalFields,
        };
      }),
      totalSize: response.totalSize,
      hasMore: !response.done,
    };
  },
});
