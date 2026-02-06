import { getZendeskTokens } from "./token-store.ts";

function getEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined") {
    // @ts-ignore: Deno global
    return Deno.env.get(name);
  }

  // @ts-ignore: Node process
  return globalThis.process?.env?.[name];
}

export interface ZendeskTicket {
  id: number;
  url: string;
  subject: string;
  description: string;
  status: "new" | "open" | "pending" | "hold" | "solved" | "closed";
  priority: "urgent" | "high" | "normal" | "low" | null;
  type: "problem" | "incident" | "question" | "task" | null;
  requester_id: number;
  submitter_id: number;
  assignee_id: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  due_at: string | null;
}

export interface ZendeskUser {
  id: number;
  url: string;
  name: string;
  email: string;
  role: "end-user" | "agent" | "admin";
  phone: string | null;
  photo: { url: string } | null;
  created_at: string;
  updated_at: string;
}

export interface ZendeskComment {
  id: number;
  type: "Comment" | "VoiceComment";
  author_id: number;
  body: string;
  html_body: string;
  public: boolean;
  created_at: string;
}

export interface ZendeskResponse<T> {
  [key: string]: T;
}

export interface ZendeskListResponse<T> {
  [key: string]: T[];
  count?: number;
  next_page?: string | null;
  previous_page?: string | null;
}

export class ZendeskClient {
  private subdomain: string;
  private accessToken: string | null = null;

  constructor() {
    const subdomain = getEnv("ZENDESK_SUBDOMAIN");
    if (!subdomain) throw new Error("ZENDESK_SUBDOMAIN not configured");
    this.subdomain = subdomain;
  }

  private get baseUrl(): string {
    return `https://${this.subdomain}.zendesk.com/api/v2`;
  }

  async ensureAuthenticated(): Promise<void> {
    const tokens = await getZendeskTokens();
    if (!tokens) {
      throw new Error(
        "Zendesk not connected. Please connect via /api/auth/zendesk",
      );
    }
    this.accessToken = tokens.accessToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    await this.ensureAuthenticated();

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Zendesk API error: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async listTickets(options: {
    limit?: number;
    status?: string;
    priority?: string;
    assigneeId?: number;
  } = {}): Promise<ZendeskTicket[]> {
    const { limit, status, priority, assigneeId } = options;

    const queryParts: string[] = [];
    if (status) queryParts.push(`status:${status}`);
    if (priority) queryParts.push(`priority:${priority}`);
    if (assigneeId) queryParts.push(`assignee:${assigneeId}`);

    let endpoint = "/tickets.json";

    if (queryParts.length > 0) {
      endpoint = `/search.json?query=type:ticket ${queryParts.join(" ")}`;
      if (limit) endpoint += `&per_page=${limit}`;
    } else if (limit) {
      endpoint += `?per_page=${limit}`;
    }

    const response = await this.request<ZendeskListResponse<ZendeskTicket>>(
      endpoint,
    );

    return response.tickets ?? response.results ?? [];
  }

  async getTicket(ticketId: number): Promise<ZendeskTicket> {
    const response = await this.request<ZendeskResponse<ZendeskTicket>>(
      `/tickets/${ticketId}.json`,
    );
    return response.ticket;
  }

  async createTicket(data: {
    subject: string;
    comment: { body: string };
    requester?: { name: string; email: string };
    priority?: "urgent" | "high" | "normal" | "low";
    type?: "problem" | "incident" | "question" | "task";
    tags?: string[];
    assignee_id?: number;
  }): Promise<ZendeskTicket> {
    const response = await this.request<ZendeskResponse<ZendeskTicket>>(
      "/tickets.json",
      {
        method: "POST",
        body: JSON.stringify({ ticket: data }),
      },
    );
    return response.ticket;
  }

  async updateTicket(
    ticketId: number,
    data: Partial<{
      subject: string;
      comment: { body: string; public: boolean };
      status: "new" | "open" | "pending" | "hold" | "solved" | "closed";
      priority: "urgent" | "high" | "normal" | "low";
      assignee_id: number;
      tags: string[];
    }>,
  ): Promise<ZendeskTicket> {
    const response = await this.request<ZendeskResponse<ZendeskTicket>>(
      `/tickets/${ticketId}.json`,
      {
        method: "PUT",
        body: JSON.stringify({ ticket: data }),
      },
    );
    return response.ticket;
  }

  async listUsers(options: { limit?: number; role?: string } = {}): Promise<
    ZendeskUser[]
  > {
    const params = new URLSearchParams();
    if (options.limit) params.set("per_page", String(options.limit));
    if (options.role) params.set("role", options.role);

    const query = params.toString();
    const endpoint = `/users.json${query ? `?${query}` : ""}`;

    const response = await this.request<ZendeskListResponse<ZendeskUser>>(
      endpoint,
    );
    return response.users ?? [];
  }

  async getUser(userId: number): Promise<ZendeskUser> {
    const response = await this.request<ZendeskResponse<ZendeskUser>>(
      `/users/${userId}.json`,
    );
    return response.user;
  }

  async searchTickets(query: string, limit = 20): Promise<ZendeskTicket[]> {
    const params = new URLSearchParams({
      query: `type:ticket ${query}`,
      per_page: String(limit),
    });

    const response = await this.request<ZendeskListResponse<ZendeskTicket>>(
      `/search.json?${params}`,
    );
    return response.results ?? [];
  }

  addComment(
    ticketId: number,
    body: string,
    isPublic = true,
  ): Promise<ZendeskTicket> {
    return this.updateTicket(ticketId, { comment: { body, public: isPublic } });
  }
}

let client: ZendeskClient | null = null;

export function getZendeskClient(): ZendeskClient {
  client ??= new ZendeskClient();
  return client;
}
