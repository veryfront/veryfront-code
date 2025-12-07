import { getAccessToken } from "./token-store.ts";

const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN || "shop.myshopify.com";
const SHOPIFY_API_VERSION = "2024-01";
const SHOPIFY_BASE_URL = `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}`;

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

async function shopifyFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
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
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Shopify API error: ${response.status} ${error.errors || response.statusText}`,
    );
  }

  return response.json();
}

export async function listProducts(options?: {
  limit?: number;
  status?: "active" | "archived" | "draft";
  productType?: string;
}): Promise<ShopifyProduct[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.status) params.set("status", options.status);
  if (options?.productType) params.set("product_type", options.productType);

  const query = params.toString() ? `?${params}` : "";
  const response = await shopifyFetch<{ products: ShopifyProduct[] }>(`/products.json${query}`);
  return response.products;
}

export async function getProduct(productId: number | string): Promise<ShopifyProduct> {
  const response = await shopifyFetch<{ product: ShopifyProduct }>(`/products/${productId}.json`);
  return response.product;
}

export async function listOrders(options?: {
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

  const query = params.toString() ? `?${params}` : "";
  const response = await shopifyFetch<{ orders: ShopifyOrder[] }>(`/orders.json${query}`);
  return response.orders;
}

export async function getOrder(orderId: number | string): Promise<ShopifyOrder> {
  const response = await shopifyFetch<{ order: ShopifyOrder }>(`/orders/${orderId}.json`);
  return response.order;
}

export async function listCustomers(options?: {
  limit?: number;
  query?: string;
}): Promise<ShopifyCustomer[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.query) params.set("query", options.query);

  const query = params.toString() ? `?${params}` : "";
  const response = await shopifyFetch<{ customers: ShopifyCustomer[] }>(`/customers.json${query}`);
  return response.customers;
}

export async function getCustomer(customerId: number | string): Promise<ShopifyCustomer> {
  const response = await shopifyFetch<{ customer: ShopifyCustomer }>(`/customers/${customerId}.json`);
  return response.customer;
}

export async function getShopInfo(): Promise<{
  id: number;
  name: string;
  email: string;
  domain: string;
  currency: string;
  timezone: string;
}> {
  const response = await shopifyFetch<{
    shop: {
      id: number;
      name: string;
      email: string;
      domain: string;
      currency: string;
      timezone: string;
    };
  }>("/shop.json");
  return response.shop;
}
