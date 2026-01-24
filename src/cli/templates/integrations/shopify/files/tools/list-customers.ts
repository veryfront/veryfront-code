import { tool } from "veryfront/tool";
import { z } from "zod";
import { listCustomers } from "../../lib/shopify-client.ts";

export default tool({
  id: "list-customers",
  description: "List customers from your Shopify store. Can search by query string.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(250)
      .default(20)
      .describe("Maximum number of customers to return"),
    query: z
      .string()
      .optional()
      .describe("Search query to filter customers (e.g., email, name)"),
  }),
  async execute({ limit, query }) {
    const customers = await listCustomers({ limit, query });

    return customers.map((customer) => ({
      id: customer.id,
      email: customer.email,
      firstName: customer.first_name,
      lastName: customer.last_name,
      phone: customer.phone,
      createdAt: customer.created_at,
      updatedAt: customer.updated_at,
      ordersCount: customer.orders_count,
      totalSpent: customer.total_spent,
      tags: customer.tags,
      state: customer.state,
      verifiedEmail: customer.verified_email,
      addresses: customer.addresses.map((address) => ({
        id: address.id,
        address1: address.address1,
        city: address.city,
        province: address.province,
        country: address.country,
        zip: address.zip,
        default: address.default,
      })),
    }));
  },
});
