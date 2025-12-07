import { tool } from "veryfront/ai";
import { z } from "zod";
import { formatAmount, getBalance } from "../../lib/stripe-client.ts";

export default tool({
  id: "get-balance",
  description: "Retrieve the current Stripe account balance including available and pending funds.",
  inputSchema: z.object({}),
  async execute() {
    const balance = await getBalance();

    return {
      livemode: balance.livemode,
      available: balance.available.map((bal) => ({
        amount: formatAmount(bal.amount, bal.currency),
        amountRaw: bal.amount,
        currency: bal.currency,
        sourceTypes: bal.source_types,
      })),
      pending: balance.pending.map((bal) => ({
        amount: formatAmount(bal.amount, bal.currency),
        amountRaw: bal.amount,
        currency: bal.currency,
        sourceTypes: bal.source_types,
      })),
    };
  },
});
