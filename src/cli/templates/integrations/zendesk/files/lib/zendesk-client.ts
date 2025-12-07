/**
 * Zendesk API Client
 *
 * Handles authentication and API calls to Zendesk REST API.
 */

import { getZendeskTokens } from "./token-store.ts";

const getEnv = (name: string): string | undefined => {
  if (typeof Deno !== "undefined") {
    // @ts-ignore: Deno global
    return Deno.env.get(name);
  }
  // @ts-ignore: Node process
  return globalThis.process?.env?.[name];
};

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
    if (!subdomain) {
      throw new Error("ZENDESK_SUBDOMAIN not configured");
    }
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

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
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

  /**
   * List tickets with optional filters
   */
  async listTickets(options: {
    limit?: number;
    status?: string;
    priority?: string;
    assigneeId?: number;
  } = {}): Promise<ZendeskTicket[]> {
    const params = new URLSearchParams();
    if (options.limit) params.set("per_page", String(options.limit));

    let endpoint = "/tickets.json";

    // Build query if filters are provided
    const queryParts: string[] = [];
    if (options.status) queryParts.push(`status:${options.status}`);
    if (options.priority) queryParts.push(`priority:${options.priority}`);
    if (options.assigneeId) queryParts.push(`assignee:${options.assigneeId}`);

    if (queryParts.length > 0) {
      endpoint = `/search.json?query=type:ticket ${queryParts.join(" ")}`;
      if (options.limit) endpoint += `&per_page=${options.limit}`;
    } else if (params.toString()) {
      endpoint += `?${params}`;
    }

    const response = await this.request<ZendeskListResponse<ZendeskTicket>>(endpoint);
    return response.tickets || response.results || [];
  }

  /**
   * Get a specific ticket by ID
   */
  async getTicket(ticketId: number): Promise<ZendeskTicket> {
    const response = await this.request<ZendeskResponse<ZendeskTicket>>(
      `/tickets/${ticketId}.json`,
    );
    return response.ticket;
  }

  /**
   * Create a new ticket
   */
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

  /**
   * Update an existing ticket
   */
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

  /**
   * List users
   */
  async listUsers(options: { limit?: number; role?: string } = {}): Promise<ZendeskUser[]> {
    const params = new URLSearchParams();
    if (options.limit) params.set("per_page", String(options.limit));
    if (options.role) params.set("role", options.role);

    const endpoint = `/users.json${params.toString() ? `?${params}` : ""}`;
    const response = await this.request<ZendeskListResponse<ZendeskUser>>(endpoint);
    return response.users || [];
  }

  /**
   * Get a specific user by ID
   */
  async getUser(userId: number): Promise<ZendeskUser> {
    const response = await this.request<ZendeskResponse<ZendeskUser>>(
      `/users/${userId}.json`,
    );
    return response.user;
  }

  /**
   * Search tickets using Zendesk query syntax
   */
  async searchTickets(query: string, limit = 20): Promise<ZendeskTicket[]> {
    const params = new URLSearchParams();
    params.set("query", `type:ticket ${query}`);
    params.set("per_page", String(limit));

    const response = await this.request<ZendeskListResponse<ZendeskTicket>>(
      `/search.json?${params}`,
    );
    return response.results || [];
  }

  /**
   * Add a comment to a ticket
   */
  addComment(
    ticketId: number,
    body: string,
    isPublic = true,
  ): Promise<ZendeskTicket> {
    return this.updateTicket(ticketId, {
      comment: { body, public: isPublic },
    });
  }
}

// Singleton instance
let client: ZendeskClient | null = null;

export function getZendeskClient(): ZendeskClient {
  if (!client) {
    client = new ZendeskClient();
  }
  return client;
}
