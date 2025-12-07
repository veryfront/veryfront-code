import { getProjectToken, getApiSecret, getProjectId } from "./token-store.ts";

const MIXPANEL_API_BASE = "https://mixpanel.com/api";
const MIXPANEL_TRACK_BASE = "https://api.mixpanel.com";
const MIXPANEL_DATA_BASE = "https://data.mixpanel.com/api/2.0";

// Types
export interface MixpanelEvent {
  event: string;
  properties: Record<string, unknown>;
}

export interface MixpanelEventQuery {
  event?: string;
  from_date: string;
  to_date: string;
  where?: string;
  limit?: number;
}

export interface MixpanelEventResult {
  event: string;
  properties: Record<string, unknown>;
}

export interface MixpanelFunnel {
  funnel_id: number;
  name: string;
  steps: Array<{
    event: string;
    count: number;
    avg_time: number | null;
    overall_conv_ratio: number;
    step_conv_ratio: number;
  }>;
  data: {
    series: string[];
    values: Record<string, number[]>;
  };
}

export interface MixpanelRetention {
  date: string;
  count: number;
  retention: Array<{
    day: number;
    count: number;
    rate: number;
  }>;
}

export interface MixpanelCohort {
  id: number;
  name: string;
  description: string;
  count: number;
  created: string;
  is_visible: boolean;
  project_id: number;
}

interface MixpanelError {
  error: string;
  request: string;
}

// Helper function to create basic auth header
function getAuthHeader(): string {
  const apiSecret = getApiSecret();
  if (!apiSecret) {
    throw new Error(
      "Not authenticated with Mixpanel. Please set MIXPANEL_API_SECRET.",
    );
  }
  // Mixpanel uses Basic auth with API secret as username and empty password
  const credentials = btoa(`${apiSecret}:`);
  return `Basic ${credentials}`;
}

// Helper function for Mixpanel API calls with auth
async function mixpanelFetch<T>(
  baseUrl: string,
  endpoint: string,
  options: RequestInit & { params?: Record<string, string | number | boolean> } = {},
): Promise<T> {
  // Build URL with query parameters
  let url = `${baseUrl}${endpoint}`;
  if (options.params) {
    const params = new URLSearchParams();
    Object.entries(options.params).forEach(([key, value]) => {
      params.append(key, String(value));
    });
    url += `?${params.toString()}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers as Record<string, string>,
  };

  // Add auth header for data API calls
  if (baseUrl === MIXPANEL_DATA_BASE || baseUrl === MIXPANEL_API_BASE) {
    headers["Authorization"] = getAuthHeader();
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `Mixpanel API error: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json() as MixpanelError;
      if (errorData.error) {
        errorMessage = `Mixpanel API error: ${errorData.error}`;
      }
    } catch {
      // If parsing JSON fails, use default error message
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data as T;
}

// Track event - uses ingestion API with project token
export async function trackEvent(
  event: string,
  properties: Record<string, unknown>,
  distinctId: string,
): Promise<{ status: number; error?: string }> {
  const projectToken = getProjectToken();
  if (!projectToken) {
    throw new Error(
      "Not authenticated with Mixpanel. Please set MIXPANEL_PROJECT_TOKEN.",
    );
  }

  const payload = {
    event,
    properties: {
      ...properties,
      token: projectToken,
      distinct_id: distinctId,
      time: Date.now(),
    },
  };

  const response = await fetch(`${MIXPANEL_TRACK_BASE}/track`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify([payload]),
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      status: 0,
      error: `Failed to track event: ${response.status} ${text}`,
    };
  }

  const result = await response.json() as { status: number; error?: string };
  return result;
}

// Query events - uses export API
export async function queryEvents(
  from: string,
  to: string,
  event?: string,
): Promise<MixpanelEventResult[]> {
  const projectId = getProjectId();
  if (!projectId) {
    throw new Error("Project ID not set. Please set MIXPANEL_PROJECT_ID.");
  }

  const params: Record<string, string> = {
    from_date: from,
    to_date: to,
  };

  if (event) {
    params.event = JSON.stringify([event]);
  }

  const response = await mixpanelFetch<string[]>(
    MIXPANEL_DATA_BASE,
    "/export",
    { params },
  );

  // Parse JSONL response (each line is a JSON object)
  const events: MixpanelEventResult[] = [];
  if (Array.isArray(response)) {
    for (const line of response) {
      if (typeof line === "string" && line.trim()) {
        try {
          const parsed = JSON.parse(line);
          events.push({
            event: parsed.event,
            properties: parsed.properties,
          });
        } catch {
          // Skip malformed lines
        }
      }
    }
  }

  return events;
}

// Get funnel data
export async function getFunnel(
  funnelId: number,
  from: string,
  to: string,
): Promise<MixpanelFunnel> {
  const params: Record<string, string | number> = {
    funnel_id: funnelId,
    from_date: from,
    to_date: to,
    unit: "day",
  };

  return mixpanelFetch<MixpanelFunnel>(
    MIXPANEL_DATA_BASE,
    "/funnels",
    { params },
  );
}

// Get retention data
export async function getRetention(
  from: string,
  to: string,
  event: string,
  retentionType: "birth" | "compounded" = "birth",
): Promise<MixpanelRetention[]> {
  const params: Record<string, string> = {
    from_date: from,
    to_date: to,
    retention_type: retentionType,
    born_event: event,
    event,
    unit: "day",
  };

  const response = await mixpanelFetch<Record<string, MixpanelRetention>>(
    MIXPANEL_DATA_BASE,
    "/retention",
    { params },
  );

  // Convert object to array
  return Object.entries(response).map(([date, data]) => ({
    date,
    ...data,
  }));
}

// List cohorts
export async function listCohorts(): Promise<MixpanelCohort[]> {
  const projectId = getProjectId();
  if (!projectId) {
    throw new Error("Project ID not set. Please set MIXPANEL_PROJECT_ID.");
  }

  const response = await mixpanelFetch<MixpanelCohort[]>(
    MIXPANEL_API_BASE,
    `/2.0/cohorts/list`,
    {
      params: {
        project_id: projectId,
      },
    },
  );

  return response;
}

// Helper functions
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDateRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);

  return {
    from: formatDate(from),
    to: formatDate(to),
  };
}

export function calculateFunnelConversionRate(funnel: MixpanelFunnel): number {
  if (!funnel.steps || funnel.steps.length < 2) {
    return 0;
  }

  const firstStep = funnel.steps[0];
  const lastStep = funnel.steps[funnel.steps.length - 1];

  if (!firstStep || !lastStep || firstStep.count === 0) {
    return 0;
  }

  return (lastStep.count / firstStep.count) * 100;
}
