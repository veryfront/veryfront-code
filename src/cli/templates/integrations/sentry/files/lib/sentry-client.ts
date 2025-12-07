import { getApiKey, getOrg } from "./token-store.ts";

const SENTRY_API_BASE_URL = "https://sentry.io/api/0";

// Sentry API Types

export interface Organization {
  id: string;
  slug: string;
  name: string;
  dateCreated: string;
  status: {
    id: string;
    name: string;
  };
  avatar?: {
    avatarType: string;
    avatarUuid: string | null;
  };
  features: string[];
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  platform?: string;
  dateCreated: string;
  isBookmarked: boolean;
  isMember: boolean;
  features: string[];
  firstEvent: string | null;
  firstTransactionEvent: boolean;
  access: string[];
  hasAccess: boolean;
  hasCustomMetrics: boolean;
  hasMinifiedStackTrace: boolean;
  hasMonitors: boolean;
  hasProfiles: boolean;
  hasReplays: boolean;
  hasSessions: boolean;
  team?: {
    id: string;
    name: string;
    slug: string;
  };
  teams: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  eventProcessing: {
    symbolicationDegraded: boolean;
  };
  status: string;
}

export interface Issue {
  id: string;
  shareId: string | null;
  shortId: string;
  title: string;
  culprit: string;
  permalink: string;
  logger: string | null;
  level: string;
  status: string;
  statusDetails: Record<string, unknown>;
  substatus: string | null;
  isPublic: boolean;
  platform: string;
  project: {
    id: string;
    name: string;
    slug: string;
    platform: string;
  };
  type: string;
  metadata: {
    value?: string;
    type?: string;
    filename?: string;
    function?: string;
    title?: string;
  };
  numComments: number;
  assignedTo: {
    id: string;
    name: string;
    type: string;
  } | null;
  isBookmarked: boolean;
  isSubscribed: boolean;
  subscriptionDetails: {
    reason?: string;
  } | null;
  hasSeen: boolean;
  annotations: string[];
  isUnhandled: boolean;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  stats?: {
    "24h": Array<[number, number]>;
  };
}

export interface Event {
  id: string;
  groupID: string;
  eventID: string;
  projectID: string;
  size: number;
  platform: string;
  message: string;
  dateCreated: string;
  dateReceived: string;
  user: {
    id?: string;
    email?: string;
    username?: string;
    ip_address?: string;
  } | null;
  entries: Array<{
    type: string;
    data: unknown;
  }>;
  contexts: Record<string, unknown>;
  tags: Array<{
    key: string;
    value: string;
  }>;
  errors: Array<{
    type: string;
    message: string;
  }>;
}

async function sentryFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const authToken = getApiKey() || process.env.SENTRY_AUTH_TOKEN;
  if (!authToken) {
    throw new Error("Not authenticated with Sentry. Please set SENTRY_AUTH_TOKEN.");
  }

  const response = await fetch(`${SENTRY_API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const errorMessage = (error as { detail?: string }).detail ||
      `Sentry API error: ${response.status} ${response.statusText}`;
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * List all organizations for the authenticated user
 */
export function listOrganizations(): Promise<Organization[]> {
  return sentryFetch<Organization[]>("/organizations/");
}

/**
 * List all projects in the configured organization
 */
export function listProjects(): Promise<Project[]> {
  const org = getOrg();
  if (!org) {
    throw new Error(
      "Sentry organization not configured. Please set SENTRY_ORG environment variable.",
    );
  }

  return sentryFetch<Project[]>(`/organizations/${org}/projects/`);
}

/**
 * Get details for a specific project
 */
export function getProject(projectSlug: string): Promise<Project> {
  const org = getOrg();
  if (!org) {
    throw new Error(
      "Sentry organization not configured. Please set SENTRY_ORG environment variable.",
    );
  }

  return sentryFetch<Project>(`/projects/${org}/${projectSlug}/`);
}

/**
 * List issues in a project with optional filters
 */
export function listIssues(
  projectSlug: string,
  options: {
    query?: string;
    status?: "resolved" | "unresolved" | "ignored";
    sort?: "date" | "new" | "freq" | "priority" | "user";
    limit?: number;
  } = {},
): Promise<Issue[]> {
  const org = getOrg();
  if (!org) {
    throw new Error(
      "Sentry organization not configured. Please set SENTRY_ORG environment variable.",
    );
  }

  const params = new URLSearchParams();
  params.append("project", projectSlug);

  if (options.query) {
    params.append("query", options.query);
  }
  if (options.status) {
    params.append("query", `is:${options.status}`);
  }
  if (options.sort) {
    params.append("sort", options.sort);
  }
  if (options.limit) {
    params.append("limit", options.limit.toString());
  }

  return sentryFetch<Issue[]>(`/organizations/${org}/issues/?${params.toString()}`);
}

/**
 * Get detailed information about a specific issue
 */
export function getIssue(issueId: string): Promise<Issue> {
  return sentryFetch<Issue>(`/issues/${issueId}/`);
}

/**
 * Update an issue (e.g., resolve, ignore, assign)
 */
export function resolveIssue(issueId: string): Promise<Issue> {
  return sentryFetch<Issue>(`/issues/${issueId}/`, {
    method: "PUT",
    body: JSON.stringify({
      status: "resolved",
    }),
  });
}

/**
 * List events for a specific issue
 */
export function listEvents(issueId: string, limit: number = 10): Promise<Event[]> {
  const params = new URLSearchParams();
  params.append("limit", limit.toString());

  return sentryFetch<Event[]>(`/issues/${issueId}/events/?${params.toString()}`);
}
