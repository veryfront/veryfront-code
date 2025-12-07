import { tool } from "veryfront/ai";
import { z } from "zod";
import { formatAddress, getAccount } from "../../lib/salesforce-client.ts";

export default tool({
  id: "get-account",
  description:
    "Get detailed information about a specific account in Salesforce CRM by their account ID.",
  inputSchema: z.object({
    accountId: z.string().describe("The Salesforce account ID (e.g., 001XXXXXXXXXXXXXXX)"),
    fields: z.array(z.string()).optional().describe(
      "Additional fields to retrieve (e.g., Description, Owner.Name, ParentId)",
    ),
  }),
  async execute({ accountId, fields }) {
    const account = await getAccount(accountId, fields);

    const billingAddress = formatAddress(
      account.BillingStreet,
      account.BillingCity,
      account.BillingState,
      account.BillingPostalCode,
      account.BillingCountry,
    );

    return {
      id: account.Id,
      name: account.Name,
      type: account.Type,
      industry: account.Industry,
      website: account.Website,
      phone: account.Phone,
      billingAddress: billingAddress || undefined,
      billingStreet: account.BillingStreet,
      billingCity: account.BillingCity,
      billingState: account.BillingState,
      billingPostalCode: account.BillingPostalCode,
      billingCountry: account.BillingCountry,
      numberOfEmployees: account.NumberOfEmployees,
      annualRevenue: account.AnnualRevenue,
      description: account.Description,
      createdDate: account.CreatedDate,
      lastModifiedDate: account.LastModifiedDate,
      additionalFields: fields
        ? Object.fromEntries(
          fields
            .filter((field) => account[field] !== undefined)
            .map((field) => [field, account[field]]),
        )
        : undefined,
    };
  },
});
