import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatAmount, formatDate, listPaymentIntents } from "../../lib/stripe-client.ts";

export default tool({
  id: "list-payments",
  description: "List Stripe payment intents. Supports filtering by customer and creation date range.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of payment intents to retrieve"),
    customerId: z.string().optional().describe("Filter by customer ID (starts with cus_)"),
    createdAfter: z.number().optional().describe("Filter payments created after this Unix timestamp"),
    createdBefore: z
      .number()
      .optional()
      .describe("Filter payments created before this Unix timestamp"),
  }),
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
