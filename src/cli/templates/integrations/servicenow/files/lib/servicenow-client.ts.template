/**
 * ServiceNow API Client
 *
 * Handles authentication and API calls to ServiceNow REST API.
 */

import { getServiceNowTokens } from "./token-store.ts";

function getEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined") {
    // @ts-ignore: Deno global
    return Deno.env.get(name);
  }
  // @ts-ignore: Node process
  return globalThis.process?.env?.[name];
}

export interface ServiceNowIncident {
  sys_id: string;
  number: string;
  short_description: string;
  description: string;
  state: string;
  priority: string;
  urgency: string;
  impact: string;
  category: string;
  subcategory: string;
  assigned_to: { display_value: string; link: string } | string;
  caller_id: { display_value: string; link: string } | string;
  opened_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  sys_created_on: string;
  sys_updated_on: string;
}

export interface ServiceNowKnowledgeArticle {
  sys_id: string;
  number: string;
  short_description: string;
  text: string;
  kb_category: string;
  published: string;
  sys_created_on: string;
}

export interface ServiceNowResponse<T> {
  result: T;
}

export interface ServiceNowListResponse<T> {
  result: T[];
}

export class ServiceNowClient {
  private instance: string;
  private accessToken: string | null = null;

  constructor() {
    const instance = getEnv("SERVICENOW_INSTANCE");
    if (!instance) throw new Error("SERVICENOW_INSTANCE not configured");

    this.instance = instance.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  private get baseUrl(): string {
    return `https://${this.instance}/api/now`;
  }

  async ensureAuthenticated(): Promise<void> {
    const tokens = await getServiceNowTokens();
    if (!tokens) {
      throw new Error(
        "ServiceNow not connected. Please connect via /api/auth/servicenow",
      );
    }
    this.accessToken = tokens.accessToken;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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
      throw new Error(`ServiceNow API error: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  /**
   * List incidents with optional filters
   */
  async listIncidents(options: {
    limit?: number;
    offset?: number;
    state?: string;
    priority?: string;
    assignedTo?: string;
    query?: string;
  } = {}): Promise<ServiceNowIncident[]> {
    const params = new URLSearchParams({
      sysparm_limit: String(options.limit ?? 20),
      sysparm_offset: String(options.offset ?? 0),
      sysparm_display_value: "all",
    });

    const queryParts: string[] = [];
    if (options.state) queryParts.push(`state=${options.state}`);
    if (options.priority) queryParts.push(`priority=${options.priority}`);
    if (options.assignedTo) queryParts.push(`assigned_to.name=${options.assignedTo}`);
    if (options.query) queryParts.push(`short_descriptionLIKE${options.query}`);

    if (queryParts.length) params.set("sysparm_query", queryParts.join("^"));

    const response = await this.request<ServiceNowListResponse<ServiceNowIncident>>(
      `/table/incident?${params}`,
    );
    return response.result;
  }

  /**
   * Get a specific incident by sys_id or number
   */
  async getIncident(idOrNumber: string): Promise<ServiceNowIncident> {
    const params = new URLSearchParams({ sysparm_display_value: "all" });

    if (idOrNumber.toUpperCase().startsWith("INC")) {
      params.set("sysparm_query", `number=${idOrNumber}`);
      const response = await this.request<ServiceNowListResponse<ServiceNowIncident>>(
        `/table/incident?${params}`,
      );

      const incident = response.result[0];
      if (!incident) throw new Error(`Incident ${idOrNumber} not found`);
      return incident;
    }

    const response = await this.request<ServiceNowResponse<ServiceNowIncident>>(
      `/table/incident/${idOrNumber}?${params}`,
    );
    return response.result;
  }

  /**
   * Create a new incident
   */
  async createIncident(data: {
    short_description: string;
    description?: string;
    urgency?: string;
    impact?: string;
    category?: string;
    subcategory?: string;
    caller_id?: string;
  }): Promise<ServiceNowIncident> {
    const response = await this.request<ServiceNowResponse<ServiceNowIncident>>(
      "/table/incident",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
    return response.result;
  }

  /**
   * Update an existing incident
   */
  async updateIncident(
    sysId: string,
    data: Partial<{
      short_description: string;
      description: string;
      state: string;
      urgency: string;
      impact: string;
      assigned_to: string;
      work_notes: string;
      close_notes: string;
    }>,
  ): Promise<ServiceNowIncident> {
    const response = await this.request<ServiceNowResponse<ServiceNowIncident>>(
      `/table/incident/${sysId}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
    );
    return response.result;
  }

  /**
   * Search knowledge base articles
   */
  async searchKnowledge(
    query: string,
    limit = 10,
  ): Promise<ServiceNowKnowledgeArticle[]> {
    const params = new URLSearchParams({
      sysparm_limit: String(limit),
      sysparm_query: `short_descriptionLIKE${query}^ORtextLIKE${query}^workflow_state=published`,
    });

    const response = await this.request<ServiceNowListResponse<ServiceNowKnowledgeArticle>>(
      `/table/kb_knowledge?${params}`,
    );
    return response.result;
  }
}

// Singleton instance
let client: ServiceNowClient | null = null;

export function getServiceNowClient(): ServiceNowClient {
  client ??= new ServiceNowClient();
  return client;
}
