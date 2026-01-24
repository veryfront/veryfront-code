import { getAccessToken } from "./token-store.ts";

const FRESHDESK_BASE_URL = "https://domain.freshdesk.com/api/v2";

interface FreshdeskTicket {
  id: number;
  subject: string;
  description: string;
  description_text: string;
  status: number;
  priority: number;
  type: string;
  requester_id: number;
  responder_id: number | null;
  due_by: string;
  fr_due_by: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  custom_fields: Record<string, unknown>;
}

interface FreshdeskContact {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  mobile: string | null;
  company_id: number | null;
  created_at: string;
  updated_at: string;
  tags: string[];
  custom_fields: Record<string, unknown>;
}

async function freshdeskFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Freshdesk. Please connect your account.");
  }

  const response = await fetch(`${FRESHDESK_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { description?: string };
    throw new Error(
      `Freshdesk API error: ${response.status} ${error.description ?? response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

function buildEndpoint(path: string, params: URLSearchParams): string {
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export async function listTickets(
  options: {
    status?: number;
    priority?: number;
    type?: string;
    page?: number;
    perPage?: number;
  } = {},
): Promise<FreshdeskTicket[]> {
  const params = new URLSearchParams();

  if (options.status !== undefined) params.set("status", String(options.status));
  if (options.priority !== undefined) params.set("priority", String(options.priority));
  if (options.type) params.set("type", options.type);
  if (options.page) params.set("page", String(options.page));
  if (options.perPage) params.set("per_page", String(options.perPage));

  return freshdeskFetch<FreshdeskTicket[]>(buildEndpoint("/tickets", params));
}

export async function getTicket(ticketId: number): Promise<FreshdeskTicket> {
  return freshdeskFetch<FreshdeskTicket>(`/tickets/${ticketId}`);
}

export async function createTicket(options: {
  subject: string;
  description: string;
  email: string;
  priority?: number;
  status?: number;
  type?: string;
  tags?: string[];
}): Promise<FreshdeskTicket> {
  const body: Record<string, unknown> = {
    subject: options.subject,
    description: options.description,
    email: options.email,
    priority: options.priority ?? 1,
    status: options.status ?? 2,
    ...(options.type ? { type: options.type } : {}),
    ...(options.tags ? { tags: options.tags } : {}),
  };

  return freshdeskFetch<FreshdeskTicket>("/tickets", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTicket(
  ticketId: number,
  updates: {
    subject?: string;
    description?: string;
    status?: number;
    priority?: number;
    type?: string;
    tags?: string[];
  },
): Promise<FreshdeskTicket> {
  const body: Record<string, unknown> = {
    ...(updates.subject !== undefined ? { subject: updates.subject } : {}),
    ...(updates.description !== undefined ? { description: updates.description } : {}),
    ...(updates.status !== undefined ? { status: updates.status } : {}),
    ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
    ...(updates.type !== undefined ? { type: updates.type } : {}),
    ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
  };

  return freshdeskFetch<FreshdeskTicket>(`/tickets/${ticketId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function listContacts(
  options: {
    email?: string;
    mobile?: string;
    phone?: string;
    companyId?: number;
    page?: number;
    perPage?: number;
  } = {},
): Promise<FreshdeskContact[]> {
  const params = new URLSearchParams();

  if (options.email) params.set("email", options.email);
  if (options.mobile) params.set("mobile", options.mobile);
  if (options.phone) params.set("phone", options.phone);
  if (options.companyId) params.set("company_id", String(options.companyId));
  if (options.page) params.set("page", String(options.page));
  if (options.perPage) params.set("per_page", String(options.perPage));

  return freshdeskFetch<FreshdeskContact[]>(buildEndpoint("/contacts", params));
}

export const TicketStatus = {
  OPEN: 2,
  PENDING: 3,
  RESOLVED: 4,
  CLOSED: 5,
} as const;

export const TicketPriority = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  URGENT: 4,
} as const;
