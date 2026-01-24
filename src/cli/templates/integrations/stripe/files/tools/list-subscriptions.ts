import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatAmount, formatDate, listSubscriptions } from "../../lib/stripe-client.ts";

export default tool({
  id: "list-subscriptions",
  description:
    "List Stripe subscriptions. Supports filtering by customer, status, and creation date range.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of subscriptions to retrieve"),
    customerId: z.string().optional().describe("Filter by customer ID (starts with cus_)"),
    status: z
      .enum([
        "incomplete",
        "incomplete_expired",
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
        "paused",
      ])
      .optional()
      .describe("Filter by subscription status"),
    createdAfter: z
      .number()
      .optional()
      .describe("Filter subscriptions created after this Unix timestamp"),
    createdBefore: z
      .number()
      .optional()
      .describe("Filter subscriptions created before this Unix timestamp"),
  }),
  async execute({ limit, customerId, status, createdAfter, createdBefore }) {
    const created =
      createdAfter || createdBefore ? { gte: createdAfter, lte: createdBefore } : undefined;

    const subscriptions = await listSubscriptions({
      limit,
      customer: customerId,
      status,
      created,
    });

    return subscriptions.map((subscription) => ({
      id: subscription.id,
      customer: subscription.customer,
      status: subscription.status,
      currentPeriodStart: formatDate(subscription.current_period_start),
      currentPeriodEnd: formatDate(subscription.current_period_end),
      created: formatDate(subscription.created),
      canceledAt: subscription.canceled_at ? formatDate(subscription.canceled_at) : null,
      items: subscription.items.data.map((item) => ({
        id: item.id,
        priceId: item.price.id,
        amount: formatAmount(item.price.unit_amount, item.price.currency),
        amountRaw: item.price.unit_amount,
        currency: item.price.currency,
        interval: item.price.recurring.interval,
        intervalCount: item.price.recurring.interval_count,
      })),
      metadata: subscription.metadata,
    }));
  },
});
