import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { formatAmount, formatDate, listPaymentIntents } from "../../lib/stripe-client.ts";

export default tool({
  id: "list-payments",
  description: "List Stripe payment intents. Supports filtering by customer and creation date range.",
  inputSchema: defineSchema((v) => v.object({
    limit: v
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of payment intents to retrieve"),
    customerId: v.string().optional().describe("Filter by customer ID (starts with cus_)"),
    createdAfter: v.number().optional().describe("Filter payments created after this Unix timestamp"),
    createdBefore: v.number().optional().describe("Filter payments created before this Unix timestamp"),
  }))(),
  async execute({ limit, customerId, createdAfter, createdBefore }) {
    const created =
      createdAfter || createdBefore ? { gte: createdAfter, lte: createdBefore } : undefined;

    const payments = await listPaymentIntents({
      limit,
      customer: customerId,
      created,
    });

    return payments.map((payment) => ({
      id: payment.id,
      amount: formatAmount(payment.amount, payment.currency),
      amountRaw: payment.amount,
      currency: payment.currency,
      status: payment.status,
      customer: payment.customer,
      description: payment.description,
      receiptEmail: payment.receipt_email,
      created: formatDate(payment.created),
      metadata: payment.metadata,
    }));
  },
});
