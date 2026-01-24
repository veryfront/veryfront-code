import { tool } from "veryfront/tool";
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
    const customer = order.customer;
    const shippingAddress = order.shipping_address;

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
      customer: customer
        ? {
            id: customer.id,
            email: customer.email,
            firstName: customer.first_name,
            lastName: customer.last_name,
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
      shippingAddress: shippingAddress
        ? {
            address1: shippingAddress.address1,
            city: shippingAddress.city,
            province: shippingAddress.province,
            country: shippingAddress.country,
            zip: shippingAddress.zip,
          }
        : null,
    };
  },
});
