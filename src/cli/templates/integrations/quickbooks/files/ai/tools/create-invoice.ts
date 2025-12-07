import { tool } from "veryfront/ai";
import { z } from "zod";
import { createInvoice } from "../../lib/quickbooks-client.ts";

export default tool({
  id: "create-invoice",
  description: "Create a new invoice in QuickBooks.",
  inputSchema: z.object({
    customerId: z.string().describe("The ID of the customer to invoice"),
    lineItems: z.array(
      z.object({
        description: z.string().optional().describe("Description of the line item"),
        amount: z.number().describe("Total amount for this line item"),
        itemId: z.string().optional().describe("QuickBooks item/service ID"),
        quantity: z.number().optional().describe("Quantity of items"),
        unitPrice: z.number().optional().describe("Price per unit"),
      }),
    ).describe("Line items for the invoice"),
    txnDate: z.string().optional().describe("Transaction date in YYYY-MM-DD format"),
    dueDate: z.string().optional().describe("Due date in YYYY-MM-DD format"),
    customerMemo: z.string().optional().describe("Memo/note for the customer"),
  }),
  async execute({ customerId, lineItems, txnDate, dueDate, customerMemo }) {
    const invoice = await createInvoice({
      customerId,
      lineItems,
      txnDate,
      dueDate,
      customerMemo,
    });

    return {
      success: true,
      invoice: {
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
      },
    };
  },
});
