import { tool } from "veryfront/ai";
import { z } from "zod";
import { createInvoice } from "../../lib/xero-client.ts";

export default tool({
  id: "create-invoice",
  description: "Create a new invoice in Xero.",
  inputSchema: z.object({
    contactId: z.string().describe("The ID of the contact for the invoice"),
    type: z
      .enum(["ACCREC", "ACCPAY"])
      .describe("Invoice type (ACCREC = sales invoice, ACCPAY = bill)"),
    date: z
      .string()
      .describe("Invoice date in YYYY-MM-DD format"),
    dueDate: z
      .string()
      .describe("Due date in YYYY-MM-DD format"),
    lineItems: z
      .array(
        z.object({
          description: z.string().describe("Line item description"),
          quantity: z.number().describe("Quantity"),
          unitAmount: z.number().describe("Unit price/amount"),
          accountCode: z.string().optional().describe("Account code"),
          taxType: z.string().optional().describe("Tax type (e.g., 'NONE', 'OUTPUT2', 'INPUT2')"),
        }),
      )
      .describe("Line items for the invoice"),
    reference: z
      .string()
      .optional()
      .describe("Optional reference number"),
    status: z
      .enum(["DRAFT", "SUBMITTED", "AUTHORISED"])
      .optional()
      .describe("Invoice status (defaults to DRAFT)"),
  }),
  async execute({ contactId, type, date, dueDate, lineItems, reference, status }) {
    const invoice = await createInvoice({
      contactId,
      type,
      date,
      dueDate,
      lineItems,
      reference,
      status,
    });

    return {
      success: true,
      invoice: {
        invoiceId: invoice.InvoiceID,
        invoiceNumber: invoice.InvoiceNumber,
        type: invoice.Type,
        status: invoice.Status,
        contact: invoice.Contact.Name,
        date: invoice.Date,
        dueDate: invoice.DueDate,
        total: invoice.Total,
        amountDue: invoice.AmountDue,
      },
    };
  },
});
