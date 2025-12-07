import { tool } from "veryfront/ai";
import { z } from "zod";
import { listCustomers } from "../../lib/quickbooks-client.ts";

export default tool({
  id: "list-customers",
  description:
    "List customers from QuickBooks. Can optionally filter by active status.",
  inputSchema: z.object({
    active: z.boolean().optional().describe("Filter by active status (true for active, false for inactive)"),
    maxResults: z.number().min(1).max(100).default(20).describe("Maximum number of customers to return"),
  }),
  async execute({ active, maxResults }) {
    const customers = await listCustomers({
      active,
      maxResults,
    });

    return customers.map((customer) => ({
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
    }));
  },
});
