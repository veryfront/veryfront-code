import { tool } from "veryfront/ai";
import { z } from "zod";
import { getInvoice } from "../../lib/quickbooks-client.ts";

export default tool({
  id: "get-invoice",
  description: "Get details of a specific QuickBooks invoice by its ID.",
  inputSchema: z.object({
    invoiceId: z.string().describe("The ID of the invoice to retrieve"),
  }),
  async execute({ invoiceId }) {
    const invoice = await getInvoice(invoiceId);

    return {
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
      billEmail: invoice.BillEmail?.Address,
      lineItems: invoice.Line.map((line) => ({
        id: line.Id,
        lineNum: line.LineNum,
        description: line.Description,
        amount: line.Amount,
        detailType: line.DetailType,
        salesItemLineDetail: line.SalesItemLineDetail ? {
          itemName: line.SalesItemLineDetail.ItemRef.name,
          quantity: line.SalesItemLineDetail.Qty,
          unitPrice: line.SalesItemLineDetail.UnitPrice,
        } : undefined,
      })),
      metadata: {
        createTime: invoice.MetaData?.CreateTime,
        lastUpdatedTime: invoice.MetaData?.LastUpdatedTime,
      },
    };
  },
});
