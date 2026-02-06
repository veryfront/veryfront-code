import { tool } from "veryfront/tool";
import { z } from "zod";
import { listCustomers } from "../../lib/quickbooks-client.ts";

export default tool({
  id: "list-customers",
  description:
    "List customers from QuickBooks. Can optionally filter by active status.",
  inputSchema: z.object({
    active: z
      .boolean()
      .optional()
      .describe(
        "Filter by active status (true for active, false for inactive)",
      ),
    maxResults: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of customers to return"),
  }),
  async execute({ active, maxResults }) {
    const customers = await listCustomers({ active, maxResults });

    return customers.map((customer) => {
      const billAddr = customer.BillAddr;

      const address = billAddr
        ? {
            line1: billAddr.Line1,
            city: billAddr.City,
            state: billAddr.CountrySubDivisionCode,
            postalCode: billAddr.PostalCode,
          }
        : undefined;

      return {
        id: customer.Id,
        displayName: customer.DisplayName,
        companyName: customer.CompanyName,
        givenName: customer.GivenName,
        familyName: customer.FamilyName,
        email: customer.PrimaryEmailAddr?.Address,
        phone: customer.PrimaryPhone?.FreeFormNumber,
        address,
        balance: customer.Balance,
        active: customer.Active,
      };
    });
  },
});
