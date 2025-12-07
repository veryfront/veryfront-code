import { tool } from "veryfront/ai";
import { z } from "zod";
import { formatDate, getCustomer } from "../../lib/stripe-client.ts";

export default tool({
  id: "get-customer",
  description: "Retrieve detailed information about a specific Stripe customer by their ID.",
  inputSchema: z.object({
    customerId: z.string().describe("The Stripe customer ID (starts with cus_)"),
  }),
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
