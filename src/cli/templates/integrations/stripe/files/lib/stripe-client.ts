import { getApiKey } from "./token-store.ts";

const STRIPE_API_VERSION = "2024-12-18.acacia";
const STRIPE_BASE_URL = "https://api.stripe.com/v1";

export interface StripeCustomer {
  id: string;
  object: "customer";
  email: string | null;
  name: string | null;
  description: string | null;
  created: number;
  metadata: Record<string, string>;
  balance: number;
  currency: string | null;
  default_source: string | null;
}

export interface StripePaymentIntent {
  id: string;
  object: "payment_intent";
  amount: number;
  currency: string;
  status:
    | "requires_payment_method"
    | "requires_confirmation"
    | "requires_action"
    | "processing"
    | "requires_capture"
    | "canceled"
    | "succeeded";
  customer: string | null;
  description: string | null;
  created: number;
  metadata: Record<string, string>;
  receipt_email: string | null;
}

export interface StripeSubscription {
  id: string;
  object: "subscription";
  customer: string;
  status:
    | "incomplete"
    | "incomplete_expired"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid"
    | "paused";
  current_period_start: number;
  current_period_end: number;
  created: number;
  canceled_at: number | null;
  metadata: Record<string, string>;
  items: {
    data: Array<{
      id: string;
      price: {
        id: string;
        unit_amount: number;
        currency: string;
        recurring: { interval: string; interval_count: number };
      };
    }>;
  };
}

export interface StripeBalance {
  object: "balance";
  available: Array<{ amount: number; currency: string; source_types?: Record<string, number> }>;
  pending: Array<{ amount: number; currency: string; source_types?: Record<string, number> }>;
  livemode: boolean;
}

export interface StripeBalanceTransaction {
  id: string;
  object: "balance_transaction";
  amount: number;
  currency: string;
  description: string | null;
  fee: number;
  net: number;
  status: "available" | "pending";
  type: string;
  created: number;
}

interface StripeListResponse<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  url: string;
}

interface StripeError {
  error: {
    message: string;
    type: string;
    code?: string;
    param?: string;
  };
}

async function stripeFetch<T>(
  endpoint: string,
  options: RequestInit & { params?: Record<string, string | number | boolean> } = {},
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Not authenticated with Stripe. Please set STRIPE_SECRET_KEY.");
  }

  let url = `${STRIPE_BASE_URL}${endpoint}`;
  if (options.params) {
    const params = new URLSearchParams();
    Object.entries(options.params).forEach(([key, value]) => {
      params.append(key, String(value));
    });
    url += `?${params.toString()}`;
  }

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    "Stripe-Version": STRIPE_API_VERSION,
    ...options.headers as Record<string, string>,
  };

  let body = options.body;
  if (options.method === "POST" && options.body && typeof options.body === "string") {
    try {
      const jsonBody = JSON.parse(options.body);
      const formData = new URLSearchParams();

      const flattenObject = (obj: Record<string, unknown>, prefix = "") => {
        for (const [key, value] of Object.entries(obj)) {
          const formKey = prefix ? `${prefix}[${key}]` : key;
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            flattenObject(value as Record<string, unknown>, formKey);
          } else if (value !== undefined && value !== null) {
            formData.append(formKey, String(value));
          }
        }
      };

      flattenObject(jsonBody);
      body = formData.toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } catch {
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body,
  });

  const data = await response.json();

  if (!response.ok) {
    const error = data as StripeError;
    throw new Error(
      `Stripe API error: ${response.status} ${error.error?.message || response.statusText}`,
    );
  }

  return data as T;
}

export async function listCustomers(options?: {
  limit?: number;
  email?: string;
  created?: { gt?: number; gte?: number; lt?: number; lte?: number };
}): Promise<StripeCustomer[]> {
  const params: Record<string, string | number> = {
    limit: options?.limit || 10,
  };

  if (options?.email) {
    params.email = options.email;
  }

  if (options?.created) {
    if (options.created.gt) params["created[gt]"] = options.created.gt;
    if (options.created.gte) params["created[gte]"] = options.created.gte;
    if (options.created.lt) params["created[lt]"] = options.created.lt;
    if (options.created.lte) params["created[lte]"] = options.created.lte;
  }

  const response = await stripeFetch<StripeListResponse<StripeCustomer>>(
    "/customers",
    { params },
  );

  return response.data;
}

export function getCustomer(customerId: string): Promise<StripeCustomer> {
  return stripeFetch<StripeCustomer>(`/customers/${customerId}`);
}

export function createCustomer(data: {
  email?: string;
  name?: string;
  description?: string;
  metadata?: Record<string, string>;
}): Promise<StripeCustomer> {
  return stripeFetch<StripeCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateCustomer(
  customerId: string,
  data: {
    email?: string;
    name?: string;
    description?: string;
    metadata?: Record<string, string>;
  },
): Promise<StripeCustomer> {
  return stripeFetch<StripeCustomer>(`/customers/${customerId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listPaymentIntents(options?: {
  limit?: number;
  customer?: string;
  created?: { gt?: number; gte?: number; lt?: number; lte?: number };
}): Promise<StripePaymentIntent[]> {
  const params: Record<string, string | number> = {
    limit: options?.limit || 10,
  };

  if (options?.customer) {
    params.customer = options.customer;
  }

  if (options?.created) {
    if (options.created.gt) params["created[gt]"] = options.created.gt;
    if (options.created.gte) params["created[gte]"] = options.created.gte;
    if (options.created.lt) params["created[lt]"] = options.created.lt;
    if (options.created.lte) params["created[lte]"] = options.created.lte;
  }

  const response = await stripeFetch<StripeListResponse<StripePaymentIntent>>(
    "/payment_intents",
    { params },
  );

  return response.data;
}

export function getPaymentIntent(paymentIntentId: string): Promise<StripePaymentIntent> {
  return stripeFetch<StripePaymentIntent>(`/payment_intents/${paymentIntentId}`);
}

export function createPaymentIntent(data: {
  amount: number;
  currency: string;
  customer?: string;
  description?: string;
  metadata?: Record<string, string>;
  payment_method?: string;
  confirm?: boolean;
}): Promise<StripePaymentIntent> {
  return stripeFetch<StripePaymentIntent>("/payment_intents", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listSubscriptions(options?: {
  limit?: number;
  customer?: string;
  status?:
    | "incomplete"
    | "incomplete_expired"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid"
    | "paused";
  created?: { gt?: number; gte?: number; lt?: number; lte?: number };
}): Promise<StripeSubscription[]> {
  const params: Record<string, string | number> = {
    limit: options?.limit || 10,
  };

  if (options?.customer) {
    params.customer = options.customer;
  }

  if (options?.status) {
    params.status = options.status;
  }

  if (options?.created) {
    if (options.created.gt) params["created[gt]"] = options.created.gt;
    if (options.created.gte) params["created[gte]"] = options.created.gte;
    if (options.created.lt) params["created[lt]"] = options.created.lt;
    if (options.created.lte) params["created[lte]"] = options.created.lte;
  }

  const response = await stripeFetch<StripeListResponse<StripeSubscription>>(
    "/subscriptions",
    { params },
  );

  return response.data;
}

export function getSubscription(subscriptionId: string): Promise<StripeSubscription> {
  return stripeFetch<StripeSubscription>(`/subscriptions/${subscriptionId}`);
}

export function getBalance(): Promise<StripeBalance> {
  return stripeFetch<StripeBalance>("/balance");
}

export async function listBalanceTransactions(options?: {
  limit?: number;
  created?: { gt?: number; gte?: number; lt?: number; lte?: number };
  type?: string;
}): Promise<StripeBalanceTransaction[]> {
  const params: Record<string, string | number> = {
    limit: options?.limit || 10,
  };

  if (options?.created) {
    if (options.created.gt) params["created[gt]"] = options.created.gt;
    if (options.created.gte) params["created[gte]"] = options.created.gte;
    if (options.created.lt) params["created[lt]"] = options.created.lt;
    if (options.created.lte) params["created[lte]"] = options.created.lte;
  }

  if (options?.type) {
    params.type = options.type;
  }

  const response = await stripeFetch<StripeListResponse<StripeBalanceTransaction>>(
    "/balance_transactions",
    { params },
  );

  return response.data;
}

export function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}
