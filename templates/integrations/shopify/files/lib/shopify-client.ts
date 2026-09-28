import { shopifyConfig } from "veryfront/oauth";
import { getValidToken, type OAuthProvider } from "./oauth.ts";

function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") return Deno.env.get(key);

  // @ts-ignore - process global
  if (typeof process !== "undefined" && process.env) return process.env[key];

  return undefined;
}

const SHOPIFY_SHOP_DOMAIN = getEnv("SHOPIFY_SHOP_DOMAIN") ?? "shop.myshopify.com";
const SHOPIFY_API_VERSION = "2024-01";
const SHOPIFY_BASE_URL = `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}`;

// The generic OAuthService does not support Shopify, so tokens resolve through
// the base scaffold's getValidToken(). Offline Shopify tokens do not expire.
const shopifyOAuthProvider: OAuthProvider = {
  name: "shopify",
  authorizationUrl: `https://${SHOPIFY_SHOP_DOMAIN}/admin/oauth/authorize`,
  tokenUrl: `https://${SHOPIFY_SHOP_DOMAIN}/admin/oauth/access_token`,
  clientId: getEnv("SHOPIFY_CLIENT_ID") ?? "",
  clientSecret: getEnv("SHOPIFY_CLIENT_SECRET") ?? "",
  scopes: [...shopifyConfig.defaultScopes],
  callbackPath: "/api/auth/shopify/callback",
};

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  status: string;
  tags: string;
  variants: Array<{
    id: number;
    title: string;
    price: string;
    sku: string;
    inventory_quantity: number;
  }>;
  images: Array<{
    id: number;
    src: string;
    alt: string | null;
  }>;
}

interface ShopifyOrder {
  id: number;
  order_number: number;
  email: string;
  created_at: string;
  updated_at: string;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  } | null;
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
    price: string;
    sku: string;
    variant_title: string;
  }>;
  shipping_address: {
    address1: string;
    city: string;
    province: string;
    country: string;
    zip: string;
  } | null;
}

interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  created_at: string;
  updated_at: string;
  orders_count: number;
  total_spent: string;
  tags: string;
  state: string;
  verified_email: boolean;
  addresses: Array<{
    id: number;
    address1: string;
    city: string;
    province: string;
    country: string;
    zip: string;
    default: boolean;
  }>;
}

function buildQuery(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function shopifyFetch<T>(
  userId: string,
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getValidToken(shopifyOAuthProvider, userId, "shopify");
  if (!token) {
    throw new Error("Not authenticated with Shopify. Please connect your account.");
  }

  const response = await fetch(`${SHOPIFY_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errors: string | undefined;
    try {
      const body = (await response.json()) as { errors?: string };
      errors = body.errors;
    } catch {
      // ignore JSON parse errors
    }

    throw new Error(`Shopify API error: ${response.status} ${errors ?? response.statusText}`);
  }

  return response.json();
}

export async function listProducts(userId: string, options?: {
  limit?: number;
  status?: "active" | "archived" | "draft";
  productType?: string;
}): Promise<ShopifyProduct[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.status) params.set("status", options.status);
  if (options?.productType) params.set("product_type", options.productType);

  const { products } = await shopifyFetch<{ products: ShopifyProduct[] }>(
    userId,
    `/products.json${buildQuery(params)}`,
  );
  return products;
}

export async function getProduct(
  userId: string,
  productId: number | string,
): Promise<ShopifyProduct> {
  const { product } = await shopifyFetch<{ product: ShopifyProduct }>(
    userId,
    `/products/${productId}.json`,
  );
  return product;
}

export async function listOrders(userId: string, options?: {
  limit?: number;
  status?: "open" | "closed" | "cancelled" | "any";
  financialStatus?: "pending" | "authorized" | "paid" | "refunded" | "voided";
  fulfillmentStatus?: "shipped" | "partial" | "unshipped" | "any" | "unfulfilled";
}): Promise<ShopifyOrder[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.status) params.set("status", options.status);
  if (options?.financialStatus) params.set("financial_status", options.financialStatus);
  if (options?.fulfillmentStatus) params.set("fulfillment_status", options.fulfillmentStatus);

  const { orders } = await shopifyFetch<{ orders: ShopifyOrder[] }>(
    userId,
    `/orders.json${buildQuery(params)}`,
  );
  return orders;
}

export async function getOrder(userId: string, orderId: number | string): Promise<ShopifyOrder> {
  const { order } = await shopifyFetch<{ order: ShopifyOrder }>(userId, `/orders/${orderId}.json`);
  return order;
}

export async function listCustomers(userId: string, options?: {
  limit?: number;
  query?: string;
}): Promise<ShopifyCustomer[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.query) params.set("query", options.query);

  const { customers } = await shopifyFetch<{ customers: ShopifyCustomer[] }>(
    userId,
    `/customers.json${buildQuery(params)}`,
  );
  return customers;
}

export async function getCustomer(
  userId: string,
  customerId: number | string,
): Promise<ShopifyCustomer> {
  const { customer } = await shopifyFetch<{ customer: ShopifyCustomer }>(
    userId,
    `/customers/${customerId}.json`,
  );
  return customer;
}

export async function getShopInfo(userId: string): Promise<{
  id: number;
  name: string;
  email: string;
  domain: string;
  currency: string;
  timezone: string;
}> {
  const { shop } = await shopifyFetch<{
    shop: {
      id: number;
      name: string;
      email: string;
      domain: string;
      currency: string;
      timezone: string;
    };
  }>(userId, "/shop.json");

  return shop;
}
