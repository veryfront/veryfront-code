import { tool } from "veryfront/tool";
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
    const billAddr = customer.BillAddr;

    return {
      id: customer.Id,
      displayName: customer.DisplayName,
      companyName: customer.CompanyName,
      givenName: customer.GivenName,
      familyName: customer.FamilyName,
      email: customer.PrimaryEmailAddr?.Address,
      phone: customer.PrimaryPhone?.FreeFormNumber,
      address: billAddr
        ? {
            line1: billAddr.Line1,
            city: billAddr.City,
            state: billAddr.CountrySubDivisionCode,
            postalCode: billAddr.PostalCode,
          }
        : undefined,
      balance: customer.Balance,
      active: customer.Active,
      metadata: {
        createTime: customer.MetaData?.CreateTime,
        lastUpdatedTime: customer.MetaData?.LastUpdatedTime,
      },
    };
  },
});
