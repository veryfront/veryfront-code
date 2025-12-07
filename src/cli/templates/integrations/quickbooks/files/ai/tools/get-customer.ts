import { tool } from "veryfront/ai";
import { z } from "zod";
import { getCustomer } from "../../lib/quickbooks-client.ts";

export default tool({
  id: "get-customer",
  description: "Get details of a specific QuickBooks customer by their ID.",
  inputSchema: z.object({
    customerId: z.string().describe("The ID of the customer to retrieve"),
  }),
  async execute({ customerId }) {
    const customer = await getCustomer(customerId);

    return {
      id: customer.Id,
      displayName: customer.DisplayName,
      companyName: customer.CompanyName,
      givenName: customer.GivenName,
      familyName: customer.FamilyName,
      email: customer.PrimaryEmailAddr?.Address,
      phone: customer.PrimaryPhone?.FreeFormNumber,
      address: customer.BillAddr ? {
        line1: customer.BillAddr.Line1,
        city: customer.BillAddr.City,
        state: customer.BillAddr.CountrySubDivisionCode,
        postalCode: customer.BillAddr.PostalCode,
      } : undefined,
      balance: customer.Balance,
      active: customer.Active,
      metadata: {
        createTime: customer.MetaData?.CreateTime,
        lastUpdatedTime: customer.MetaData?.LastUpdatedTime,
      },
    };
  },
});
