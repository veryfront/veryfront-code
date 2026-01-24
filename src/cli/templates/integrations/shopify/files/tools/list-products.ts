import { tool } from "veryfront/tool";
import { z } from "zod";
import { listProducts } from "../../lib/shopify-client.ts";

export default tool({
  id: "list-products",
  description:
    "List products from your Shopify store. Can filter by status and product type.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(250)
      .default(20)
      .describe("Maximum number of products to return"),
    status: z
      .enum(["active", "archived", "draft"])
      .optional()
      .describe("Filter by product status"),
    productType: z.string().optional().describe("Filter by product type"),
  }),
  async execute({ limit, status, productType }) {
    const products = await listProducts({ limit, status, productType });

    return products.map((product) => ({
      id: product.id,
      title: product.title,
      vendor: product.vendor,
      productType: product.product_type,
      status: product.status,
      tags: product.tags,
      createdAt: product.created_at,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        title: variant.title,
        price: variant.price,
        sku: variant.sku,
        inventoryQuantity: variant.inventory_quantity,
      })),
      images: product.images.map((image) => ({
        id: image.id,
        src: image.src,
        alt: image.alt,
      })),
    }));
  },
});
