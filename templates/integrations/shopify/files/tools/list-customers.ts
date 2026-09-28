import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listCustomers } from "../lib/shopify-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "shopify-list-customers",
  description: "List customers from your Shopify store. Can search by query string.",
  inputSchema: defineSchema((v) => v.object({
    limit: v
      .number()
      .min(1)
      .max(250)
      .default(20)
      .describe("Maximum number of customers to return"),
    query: v
      .string()
      .optional()
      .describe("Search query to filter customers (e.g., email, name)"),
  }))(),
  async execute({ limit, query }, context) {
    const userId = requireUserIdFromContext(context);
    const customers = await listCustomers(userId, { limit, query });

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
