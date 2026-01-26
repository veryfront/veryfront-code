import { tool } from "veryfront/tool";
import { z } from "zod";
import { listInvoices } from "../../lib/xero-client.ts";

export default tool({
  id: "list-invoices",
  description: "List invoices from Xero. Can filter by status, type, or contact.",
  inputSchema: z.object({
    status: z
      .enum(["DRAFT", "SUBMITTED", "AUTHORISED", "PAID", "VOIDED"])
      .optional()
      .describe("Filter by invoice status"),
    type: z
      .enum(["ACCREC", "ACCPAY"])
      .optional()
      .describe("Filter by invoice type (ACCREC = sales invoice, ACCPAY = bill)"),
    contactId: z.string().optional().describe("Filter by contact ID"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of invoices to return"),
  }),
  async execute({ status, type, contactId, limit }) {
    const invoices = await listInvoices({ status, type, contactId, limit });

    return invoices.map((invoice) => ({
      invoiceId: invoice.InvoiceID,
      invoiceNumber: invoice.InvoiceNumber,
      type: invoice.Type,
      status: invoice.Status,
      contact: invoice.Contact.Name,
      date: invoice.Date,
      dueDate: invoice.DueDate,
      subTotal: invoice.SubTotal,
      totalTax: invoice.TotalTax,
      total: invoice.Total,
      amountDue: invoice.AmountDue,
      amountPaid: invoice.AmountPaid,
      currencyCode: invoice.CurrencyCode,
      reference: invoice.Reference,
    }));
  },
});
