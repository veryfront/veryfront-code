import { getAccessToken } from "./token-store.ts";

const INTERCOM_BASE_URL = "https://api.intercom.io";

interface IntercomResponse<T> {
  type: string;
  data?: T;
  pages?: {
    next?: string | null;
    page: number;
    per_page: number;
    total_pages: number;
  };
}

interface IntercomContact {
  type: "contact";
  id: string;
  external_id?: string;
  email?: string;
  phone?: string;
  name?: string;
  avatar?: string;
  role?: string;
  created_at: number;
  updated_at: number;
  signed_up_at?: number;
  last_seen_at?: number;
  owner_id?: number;
  custom_attributes?: Record<string, unknown>;
  tags?: Array<{ id: string; name: string }>;
}

interface IntercomConversation {
  type: "conversation";
  id: string;
  created_at: number;
  updated_at: number;
  source: {
    type: string;
    id: string;
    delivered_as: string;
    subject?: string;
    body?: string;
    author: {
      type: string;
      id: string;
      name?: string;
      email?: string;
    };
  };
  contacts?: Array<{
    type: string;
    id: string;
  }>;
  teammates?: Array<{
    type: string;
    id: string;
  }>;
  title?: string;
  state: "open" | "closed" | "snoozed";
  read: boolean;
  waiting_since?: number;
  snoozed_until?: number;
  priority?: "priority" | "not_priority";
  conversation_parts?: {
    type: string;
    conversation_parts: Array<{
      type: string;
      id: string;
      part_type: string;
      body: string;
      created_at: number;
      updated_at: number;
      author: {
        type: string;
        id: string;
        name?: string;
        email?: string;
      };
    }>;
  };
}

interface IntercomMessageRequest {
  message_type: "inapp" | "email" | "comment";
  body: string;
  from: {
    type: "admin" | "user" | "contact";
    id: string;
  };
  to?: {
    type: "user" | "contact";
    id?: string;
    email?: string;
  };
}

function hasMorePages(pages?: IntercomResponse<unknown>["pages"]): boolean {
  return pages ? pages.page < pages.total_pages : false;
}

async function intercomFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Intercom. Please connect your account.");
  }

  const response = await fetch(`${INTERCOM_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Intercom-Version": "2.11",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({} as Record<string, unknown>));
    const message =
      (error as { errors?: Array<{ message?: string }>; message?: string }).errors?.[0]?.message ??
      (error as { message?: string }).message ??
      response.statusText;

    throw new Error(`Intercom API error: ${response.status} ${message}`);
  }

  return response.json() as Promise<T>;
}

export async function listContacts(
  options: { page?: number; perPage?: number } = {},
): Promise<{ contacts: IntercomContact[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    per_page: String(options.perPage ?? 50),
  });

  if (options.page) params.set("page", String(options.page));

  const response = await intercomFetch<IntercomResponse<IntercomContact[]>>(`/contacts?${params}`);

  return {
    contacts: response.data ?? [],
    hasMore: hasMorePages(response.pages),
  };
}

export async function getContact(contactId: string): Promise<IntercomContact> {
  return intercomFetch<IntercomContact>(`/contacts/${contactId}`);
}

export async function searchContacts(query: { email?: string; name?: string }): Promise<IntercomContact[]> {
  const value: Array<Record<string, unknown>> = [];

  if (query.email) {
    value.push({ field: "email", operator: "=", value: query.email });
  }

  if (query.name) {
    value.push({ field: "name", operator: "~", value: query.name });
  }

  const searchQuery = {
    query: {
      operator: "AND",
      value,
    },
  };

  const response = await intercomFetch<IntercomResponse<IntercomContact[]>>("/contacts/search", {
    method: "POST",
    body: JSON.stringify(searchQuery),
  });

  return response.data ?? [];
}

export async function listConversations(
  options: { page?: number; perPage?: number; open?: boolean } = {},
): Promise<{ conversations: IntercomConversation[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    per_page: String(options.perPage ?? 50),
    display_as: "plaintext",
  });

  if (options.page) params.set("page", String(options.page));
  if (options.open !== undefined) params.set("state", options.open ? "open" : "closed");

  const response = await intercomFetch<IntercomResponse<IntercomConversation[]>>(
    `/conversations?${params}`,
  );

  return {
    conversations: response.data ?? [],
    hasMore: hasMorePages(response.pages),
  };
}

export async function getConversation(conversationId: string): Promise<IntercomConversation> {
  return intercomFetch<IntercomConversation>(`/conversations/${conversationId}`);
}

export async function sendMessage(options: {
  conversationId?: string;
  body: string;
  messageType?: "comment" | "note";
  adminId?: string;
}): Promise<IntercomConversation> {
  if (!options.conversationId) {
    throw new Error("conversationId is required to send a message");
  }

  const body: Record<string, unknown> = {
    message_type: options.messageType ?? "comment",
    type: "admin",
    body: options.body,
  };

  if (options.adminId) body.admin_id = options.adminId;

  return intercomFetch<IntercomConversation>(`/conversations/${options.conversationId}/reply`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createMessage(options: {
  contactId?: string;
  email?: string;
  body: string;
  messageType: "inapp" | "email";
  fromId: string;
}): Promise<{ type: string; id: string }> {
  const messageBody: IntercomMessageRequest = {
    message_type: options.messageType,
    body: options.body,
    from: {
      type: "admin",
      id: options.fromId,
    },
  };

  if (options.contactId) {
    messageBody.to = { type: "contact", id: options.contactId };
  } else if (options.email) {
    messageBody.to = { type: "contact", email: options.email };
  } else {
    throw new Error("Either contactId or email is required");
  }

  return intercomFetch<{ type: string; id: string }>("/messages", {
    method: "POST",
    body: JSON.stringify(messageBody),
  });
}

export async function getMe(): Promise<{ type: string; id: string; name: string; email: string }> {
  return intercomFetch<{ type: string; id: string; name: string; email: string }>("/me");
}
