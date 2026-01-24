import { tool } from "veryfront/tool";
import { z } from "zod";
import { getProduct } from "../../lib/shopify-client.ts";

export default tool({
  id: "get-product",
  description: "Get details of a specific Shopify product by its ID.",
  inputSchema: z.object({
    productId: z.union([z.number(), z.string()]).describe("The ID of the product to retrieve"),
  }),
  async execute({ productId }) {
    const product = await getProduct(productId);

    return {
      id: product.id,
      title: product.title,
      bodyHtml: product.body_html,
      vendor: product.vendor,
      productType: product.product_type,
      status: product.status,
      tags: product.tags,
      createdAt: product.created_at,
      updatedAt: product.updated_at,
      publishedAt: product.published_at,
      variants: product.variants.map(({ id, title, price, sku, inventory_quantity }) => ({
        id,
        title,
        price,
        sku,
        inventoryQuantity: inventory_quantity,
      })),
      images: product.images.map(({ id, src, alt }) => ({
        id,
        src,
        alt,
      })),
    };
  },
});
