import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { formatDate, getCustomer } from "../lib/stripe-client.ts";

export default tool({
  id: "stripe-get-customer",
  description: "Retrieve detailed information about a specific Stripe customer by their ID.",
  inputSchema: defineSchema((v) => v.object({
    customerId: v.string().describe("The Stripe customer ID (starts with cus_)"),
  }))(),
  async execute({ customerId }) {
    const customer = await getCustomer(customerId);

    return {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      description: customer.description,
      created: formatDate(customer.created),
      balance: customer.balance,
      currency: customer.currency,
      defaultSource: customer.default_source,
      metadata: customer.metadata,
    };
  },
});
