import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { formatDate, listCustomers } from "../../lib/stripe-client.ts";

export default tool({
  id: "list-customers",
  description: "List Stripe customers. Supports filtering by email and creation date range.",
  inputSchema: defineSchema((v) => v.object({
    limit: v
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of customers to retrieve"),
    email: v.string().email().optional().describe("Filter by customer email address"),
    createdAfter: v.number().optional().describe("Filter customers created after this Unix timestamp"),
    createdBefore: v
      .number()
      .optional()
      .describe("Filter customers created before this Unix timestamp"),
  }))(),
  async execute({ limit, email, createdAfter, createdBefore }) {
    const created =
      createdAfter != null || createdBefore != null
        ? { gte: createdAfter, lte: createdBefore }
        : undefined;

    const customers = await listCustomers({ limit, email, created });

    return customers.map((customer) => ({
      id: customer.id,
      email: customer.email,
      name: customer.name,
      description: customer.description,
      created: formatDate(customer.created),
      balance: customer.balance,
      currency: customer.currency,
      metadata: customer.metadata,
    }));
  },
});
