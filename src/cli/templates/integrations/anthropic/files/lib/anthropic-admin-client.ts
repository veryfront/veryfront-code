/**
 * Anthropic Admin API Client
 *
 * Provides methods to interact with the Anthropic Admin API for organization management.
 * Requires an admin API key with appropriate permissions.
 *
 * @see https://docs.anthropic.com/en/api/admin-api
 */

const ANTHROPIC_ADMIN_API_BASE_URL = 'https://api.anthropic.com/v1/admin';

export interface AnthropicWorkspace {
  id: string;
  name: string;
  display_name: string;
  created_at: string;
}

export interface AnthropicUsageRecord {
  workspace_id: string;
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  total_cost_usd: number;
}

export interface AnthropicAPIKey {
  id: string;
  name: string;
  workspace_id?: string;
  created_at: string;
  last_used_at?: string;
  status: 'active' | 'revoked';
  key_type: 'admin' | 'workspace' | 'service';
}

export interface AnthropicMember {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'developer';
  status: 'active' | 'pending' | 'inactive';
  created_at: string;
  last_active_at?: string;
}

export interface AnthropicOrganization {
  id: string;
  name: string;
  display_name: string;
  created_at: string;
  settings: {
    default_model?: string;
    rate_limit_tier?: string;
    billing_email?: string;
  };
}

export interface AnthropicUsageOptions {
  startDate: string;
  endDate: string;
  workspaceId?: string;
  model?: string;
  granularity?: 'day' | 'hour';
}

export class AnthropicAdminError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'AnthropicAdminError';
  }
}

/**
 * Client for interacting with the Anthropic Admin API
 */
export class AnthropicAdminClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.ANTHROPIC_ADMIN_API_KEY || '';
    this.baseUrl = baseUrl || ANTHROPIC_ADMIN_API_BASE_URL;

    if (!this.apiKey) {
      throw new AnthropicAdminError(
        'ANTHROPIC_ADMIN_API_KEY is required. Please set it in your environment variables.'
      );
    }

    if (!this.apiKey.startsWith('sk-ant-')) {
      throw new AnthropicAdminError(
        'Invalid Anthropic API key format. Admin keys should start with "sk-ant-"'
      );
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new AnthropicAdminError(
        errorData.error?.message || `API request failed: ${response.statusText}`,
        response.status,
        errorData
      );
    }

    return response.json();
  }

  /**
   * List all workspaces in the organization
   */
  async listWorkspaces(): Promise<{ workspaces: AnthropicWorkspace[] }> {
    return this.request<{ workspaces: AnthropicWorkspace[] }>('/workspaces');
  }

  /**
   * Get details for a specific workspace
   */
  async getWorkspace(workspaceId: string): Promise<AnthropicWorkspace> {
    if (!workspaceId) {
      throw new AnthropicAdminError('workspaceId is required');
    }
    return this.request<AnthropicWorkspace>(`/workspaces/${workspaceId}`);
  }

  /**
   * Get API usage statistics for a date range
   *
   * @param options - Usage query options
   * @returns Usage records grouped by date, workspace, and model
   */
  async getUsage(options: AnthropicUsageOptions): Promise<{
    usage: AnthropicUsageRecord[];
    total_cost_usd: number;
  }> {
    const { startDate, endDate, workspaceId, model, granularity = 'day' } = options;

    if (!startDate || !endDate) {
      throw new AnthropicAdminError('startDate and endDate are required');
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      throw new AnthropicAdminError(
        'Dates must be in YYYY-MM-DD format'
      );
    }

    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      granularity,
    });

    if (workspaceId) {
      params.append('workspace_id', workspaceId);
    }

    if (model) {
      params.append('model', model);
    }

    return this.request<{
      usage: AnthropicUsageRecord[];
      total_cost_usd: number;
    }>(`/usage?${params.toString()}`);
  }

  /**
   * List API keys for the organization or a specific workspace
   */
  async listAPIKeys(workspaceId?: string): Promise<{ api_keys: AnthropicAPIKey[] }> {
    const endpoint = workspaceId
      ? `/workspaces/${workspaceId}/api-keys`
      : '/api-keys';

    return this.request<{ api_keys: AnthropicAPIKey[] }>(endpoint);
  }

  /**
   * List all members in the organization
   */
  async listMembers(): Promise<{ members: AnthropicMember[] }> {
    return this.request<{ members: AnthropicMember[] }>('/members');
  }

  /**
   * Get organization details and settings
   */
  async getOrganization(): Promise<AnthropicOrganization> {
    return this.request<AnthropicOrganization>('/organization');
  }

  /**
   * Create a new API key (admin functionality)
   */
  async createAPIKey(data: {
    name: string;
    workspace_id?: string;
    key_type?: 'workspace' | 'service';
  }): Promise<{ api_key: AnthropicAPIKey & { key: string } }> {
    return this.request<{ api_key: AnthropicAPIKey & { key: string } }>(
      '/api-keys',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }

  /**
   * Revoke an API key
   */
  async revokeAPIKey(keyId: string): Promise<{ success: boolean }> {
    if (!keyId) {
      throw new AnthropicAdminError('keyId is required');
    }

    return this.request<{ success: boolean }>(
      `/api-keys/${keyId}/revoke`,
      {
        method: 'POST',
      }
    );
  }
}

/**
 * Get a singleton instance of the Anthropic Admin client
 */
let client: AnthropicAdminClient | null = null;

export function getAnthropicAdminClient(): AnthropicAdminClient {
  if (!client) {
    client = new AnthropicAdminClient();
  }
  return client;
}

export default AnthropicAdminClient;
