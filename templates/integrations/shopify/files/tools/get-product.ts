import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getProduct } from "../lib/shopify-client.ts";

export default tool({
  id: "shopify-get-product",
  description: "Get details of a specific Shopify product by its ID.",
  inputSchema: defineSchema((v) => v.object({
    productId: v.union([v.number(), v.string()]).describe("The ID of the product to retrieve"),
  }))(),
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
    };
  },
});
