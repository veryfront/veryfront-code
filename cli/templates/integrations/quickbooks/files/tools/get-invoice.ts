import { tool } from "veryfront/tool";
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
      lineItems: invoice.Line.map((line) => {
        const detail = line.SalesItemLineDetail;

        return {
          id: line.Id,
          lineNum: line.LineNum,
          description: line.Description,
          amount: line.Amount,
          detailType: line.DetailType,
          salesItemLineDetail: detail
            ? {
                itemName: detail.ItemRef.name,
                quantity: detail.Qty,
                unitPrice: detail.UnitPrice,
              }
            : undefined,
        };
      }),
      metadata: {
        createTime: invoice.MetaData?.CreateTime,
        lastUpdatedTime: invoice.MetaData?.LastUpdatedTime,
      },
    };
  },
});
