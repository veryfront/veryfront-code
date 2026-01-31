import { tool } from "veryfront/tool";
import { z } from "zod";
import { listOrders } from "../../lib/shopify-client.ts";

export default tool({
  id: "list-orders",
  description:
    "List orders from your Shopify store. Can filter by status, financial status, and fulfillment status.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(250)
      .default(20)
      .describe("Maximum number of orders to return"),
    status: z
      .enum(["open", "closed", "cancelled", "any"])
      .optional()
      .describe("Filter by order status"),
    financialStatus: z
      .enum(["pending", "authorized", "paid", "refunded", "voided"])
      .optional()
      .describe("Filter by financial status"),
    fulfillmentStatus: z
      .enum(["shipped", "partial", "unshipped", "any", "unfulfilled"])
      .optional()
      .describe("Filter by fulfillment status"),
  }),
  async execute({ limit, status, financialStatus, fulfillmentStatus }) {
    const orders = await listOrders({
      limit,
      status,
      financialStatus,
      fulfillmentStatus,
    });

    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      email: order.email,
      createdAt: order.created_at,
      totalPrice: order.total_price,
      subtotalPrice: order.subtotal_price,
      totalTax: order.total_tax,
      currency: order.currency,
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      customer: order.customer
        ? {
            id: order.customer.id,
            email: order.customer.email,
            firstName: order.customer.first_name,
            lastName: order.customer.last_name,
          }
        : null,
      lineItems: order.line_items.map((item) => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        price: item.price,
        sku: item.sku,
        variantTitle: item.variant_title,
      })),
      shippingAddress: order.shipping_address
        ? {
            address1: order.shipping_address.address1,
            city: order.shipping_address.city,
            province: order.shipping_address.province,
            country: order.shipping_address.country,
            zip: order.shipping_address.zip,
          }
        : null,
    }));
  },
});
