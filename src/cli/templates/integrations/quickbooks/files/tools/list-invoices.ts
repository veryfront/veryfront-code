import { tool } from "veryfront/tool";
import { z } from "zod";
import { listInvoices } from "../../lib/quickbooks-client.ts";

export default tool({
  id: "list-invoices",
  description: "List invoices from QuickBooks. Can optionally filter by customer ID.",
  inputSchema: z.object({
    customerId: z.string().optional().describe("Customer ID to filter invoices by"),
    maxResults: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of invoices to return"),
  }),
  async execute({ customerId, maxResults }) {
    const invoices = await listInvoices({ customerId, maxResults });

    return invoices.map((invoice) => ({
      id: invoice.Id,
      docNumber: invoice.DocNumber,
      txnDate: invoice.TxnDate,
      dueDate: invoice.DueDate,
      totalAmount: invoice.TotalAmt,
      balance: invoice.Balance,
      customer: {
        id: invoice.CustomerRef.value,
        name: invoice.CustomerRef.name,
      },
      status: invoice.TxnStatus,
      emailStatus: invoice.EmailStatus,
      lineItems: invoice.Line.map((line) => ({
        description: line.Description,
        amount: line.Amount,
        quantity: line.SalesItemLineDetail?.Qty,
        unitPrice: line.SalesItemLineDetail?.UnitPrice,
      })),
    }));
  },
});
