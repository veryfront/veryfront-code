import { tool } from "veryfront/ai";
import { z } from "zod";
import { getOrder } from "../../lib/shopify-client.ts";

export default tool({
  id: "get-order",
  description: "Get details of a specific Shopify order by its ID.",
  inputSchema: z.object({
    orderId: z.union([z.number(), z.string()]).describe("The ID of the order to retrieve"),
  }),
  async execute({ orderId }) {
    const order = await getOrder(orderId);

    return {
      id: order.id,
      orderNumber: order.order_number,
      email: order.email,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      totalPrice: order.total_price,
      subtotalPrice: order.subtotal_price,
      totalTax: order.total_tax,
      currency: order.currency,
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      customer: order.customer ? {
        id: order.customer.id,
        email: order.customer.email,
        firstName: order.customer.first_name,
        lastName: order.customer.last_name,
      } : null,
      lineItems: order.line_items.map((item) => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        price: item.price,
        sku: item.sku,
        variantTitle: item.variant_title,
      })),
      shippingAddress: order.shipping_address ? {
        address1: order.shipping_address.address1,
        city: order.shipping_address.city,
        province: order.shipping_address.province,
        country: order.shipping_address.country,
        zip: order.shipping_address.zip,
      } : null,
    };
  },
});
