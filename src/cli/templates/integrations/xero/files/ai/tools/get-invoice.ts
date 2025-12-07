import { tool } from "veryfront/ai";
import { z } from "zod";
import { getInvoice } from "../../lib/xero-client.ts";

export default tool({
  id: "get-invoice",
  description: "Get details of a specific Xero invoice by its ID.",
  inputSchema: z.object({
    invoiceId: z.string().describe("The ID of the invoice to retrieve"),
  }),
  async execute({ invoiceId }) {
    const invoice = await getInvoice(invoiceId);

    return {
      invoiceId: invoice.InvoiceID,
      invoiceNumber: invoice.InvoiceNumber,
      type: invoice.Type,
      status: invoice.Status,
      contact: {
        contactId: invoice.Contact.ContactID,
        name: invoice.Contact.Name,
      },
      lineItems: invoice.LineItems.map((item) => ({
        lineItemId: item.LineItemID,
        description: item.Description,
        quantity: item.Quantity,
        unitAmount: item.UnitAmount,
        lineAmount: item.LineAmount,
        accountCode: item.AccountCode,
        taxType: item.TaxType,
      })),
      date: invoice.Date,
      dueDate: invoice.DueDate,
      subTotal: invoice.SubTotal,
      totalTax: invoice.TotalTax,
      total: invoice.Total,
      amountDue: invoice.AmountDue,
      amountPaid: invoice.AmountPaid,
      currencyCode: invoice.CurrencyCode,
      reference: invoice.Reference,
      updatedDateUTC: invoice.UpdatedDateUTC,
    };
  },
});
