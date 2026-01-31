import { getApiKey } from "./token-store.ts";

const DEFAULT_POSTHOG_HOST = "https://app.posthog.com";

export interface PostHogInsight {
  id: number;
  name: string;
  derived_name: string | null;
  description: string;
  filters: Record<string, unknown>;
  result: unknown;
  created_at: string;
  created_by: {
    id: number;
    uuid: string;
    distinct_id: string;
    first_name: string;
    email: string;
  } | null;
}

export interface PostHogTrend {
  action: {
    id: string;
    name: string;
    type: string;
  };
  label: string;
  count: number;
  data: number[];
  labels: string[];
  days: string[];
}

export interface PostHogFunnel {
  id: number;
  name: string;
  steps: Array<{
    action_id: string;
    name: string;
    order: number;
    count: number;
    average_conversion_time: number | null;
  }>;
  filters: Record<string, unknown>;
}

export interface PostHogFeatureFlag {
  id: number;
  name: string;
  key: string;
  filters: {
    groups: Array<{
      properties: unknown[];
      rollout_percentage: number | null;
    }>;
  };
  deleted: boolean;
  active: boolean;
  created_at: string;
  created_by: {
    id: number;
    uuid: string;
    distinct_id: string;
    first_name: string;
    email: string;
  } | null;
  is_simple_flag: boolean;
  rollout_percentage: number | null;
  ensure_experience_continuity: boolean;
}

export interface PostHogPerson {
  id: string;
  name: string;
  distinct_ids: string[];
  properties: Record<string, unknown>;
  created_at: string;
  uuid: string;
}

export interface PostHogEvent {
  event: string;
  distinct_id: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
}

interface PostHogListResponse<T> {
  next: string | null;
  previous: string | null;
  results: T[];
}

interface PostHogError {
  detail?: string;
}

function getPostHogHost(): string {
  return process.env.POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST;
}

function buildParams(
  options?: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> | undefined {
  if (!options) return undefined;

  const params: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) params[key] = value;
  }

  return Object.keys(params).length ? params : undefined;
}

async function posthogFetch<T>(
  endpoint: string,
  options: RequestInit & { params?: Record<string, string | number | boolean> } = {},
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Not authenticated with PostHog. Please set POSTHOG_API_KEY.");
  }

  const url = new URL(`${getPostHogHost()}/api${endpoint}`);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    url.searchParams.append(key, String(value));
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  const response = await fetch(url.toString(), { ...options, headers });
  const data: unknown = await response.json();

  if (!response.ok) {
    const error = data as PostHogError;
    throw new Error(`PostHog API error: ${response.status} ${error.detail ?? response.statusText}`);
  }

  return data as T;
}

export function getInsights(options?: {
  limit?: number;
}): Promise<PostHogListResponse<PostHogInsight>> {
  return posthogFetch<PostHogListResponse<PostHogInsight>>("/projects/@current/insights/", {
    params: buildParams({ limit: options?.limit }),
  });
}

export function getTrends(options: {
  events?: Array<{ id: string; name?: string; type?: string }>;
  date_from?: string;
  date_to?: string;
  interval?: "hour" | "day" | "week" | "month";
  properties?: Record<string, unknown>[];
}): Promise<PostHogTrend[]> {
  const body = {
    events: options.events ?? [{ id: "$pageview", name: "$pageview", type: "events" }],
    date_from: options.date_from ?? "-7d",
    date_to: options.date_to ?? "now",
    interval: options.interval ?? "day",
    properties: options.properties ?? [],
  };

  return posthogFetch<PostHogTrend[]>("/projects/@current/insights/trend/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getFunnels(options: {
  events?: Array<{ id: string; name?: string; order: number }>;
  date_from?: string;
  date_to?: string;
}): Promise<PostHogFunnel> {
  const body = {
    events: options.events ?? [],
    date_from: options.date_from ?? "-7d",
    date_to: options.date_to ?? "now",
  };

  return posthogFetch<PostHogFunnel>("/projects/@current/insights/funnel/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getFeatureFlags(options?: {
  limit?: number;
}): Promise<PostHogListResponse<PostHogFeatureFlag>> {
  return posthogFetch<PostHogListResponse<PostHogFeatureFlag>>(
    "/projects/@current/feature_flags/",
    { params: buildParams({ limit: options?.limit }) },
  );
}

export function getFeatureFlag(flagId: number): Promise<PostHogFeatureFlag> {
  return posthogFetch<PostHogFeatureFlag>(`/projects/@current/feature_flags/${flagId}/`);
}

export function listPersons(options?: {
  limit?: number;
  search?: string;
}): Promise<PostHogListResponse<PostHogPerson>> {
  return posthogFetch<PostHogListResponse<PostHogPerson>>("/projects/@current/persons/", {
    params: buildParams({ limit: options?.limit, search: options?.search }),
  });
}

export function getPerson(personId: string): Promise<PostHogPerson> {
  return posthogFetch<PostHogPerson>(`/projects/@current/persons/${personId}/`);
}

export function captureEvent(event: PostHogEvent): Promise<{ status: number }> {
  const body = {
    api_key: getApiKey(),
    event: event.event,
    distinct_id: event.distinct_id,
    properties: event.properties ?? {},
    timestamp: event.timestamp ?? new Date().toISOString(),
  };

  return posthogFetch<{ status: number }>("/capture/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toISOString();
}

export function calculateConversionRate(funnel: PostHogFunnel): number {
  if (funnel.steps.length < 2) return 0;

  const firstStep = funnel.steps[0];
  if (firstStep.count === 0) return 0;

  const lastStep = funnel.steps[funnel.steps.length - 1];
  return (lastStep.count / firstStep.count) * 100;
}
