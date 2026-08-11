import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listProducts } from "../lib/shopify-client.ts";

export default tool({
  id: "shopify-list-products",
  description:
    "List products from your Shopify store. Can filter by status and product type.",
  inputSchema: defineSchema((v) => v.object({
    limit: v
      .number()
      .min(1)
      .max(250)
      .default(20)
      .describe("Maximum number of products to return"),
    status: v
      .enum(["active", "archived", "draft"])
      .optional()
      .describe("Filter by product status"),
    productType: v.string().optional().describe("Filter by product type"),
  }))(),
  async execute({ limit, status, productType }) {
    const products = await listProducts({ limit, status, productType });

    return products.map(
      ({
        id,
        title,
        vendor,
        product_type,
        status: productStatus,
        tags,
        created_at,
        variants,
        images,
      }) => ({
        id,
        title,
        vendor,
        productType: product_type,
        status: productStatus,
        tags,
        createdAt: created_at,
        variants: variants.map(
          ({ id, title, price, sku, inventory_quantity }) => ({
            id,
            title,
            price,
            sku,
            inventoryQuantity: inventory_quantity,
          }),
        ),
        images: images.map(({ id, src, alt }) => ({ id, src, alt })),
      }),
    );
  },
});
