import { jiraConfig, OAuthService } from "veryfront/oauth";
import { tokenStore } from "./token-store.ts";

// OAuthService refreshes expired tokens under the store's refresh lock.
const jiraService = new OAuthService(jiraConfig, tokenStore);

function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") return Deno.env.get(key);

  // @ts-ignore - process global
  if (typeof process !== "undefined" && process.env) return process.env[key];

  return undefined;
}

/** The Atlassian site's cloud ID, from JIRA_CLOUD_ID. */
function getCloudId(): string | undefined {
  return getEnv("JIRA_CLOUD_ID");
}

const JIRA_API_VERSION = "3";

interface JiraResponse<T> {
  expand?: string;
  startAt?: number;
  maxResults?: number;
  total?: number;
  issues?: T[];
  values?: T[];
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?:
      | {
        type: string;
        content: unknown[];
      }
      | string;
    status: {
      name: string;
      statusCategory: {
        key: string;
        name: string;
      };
    };
    issuetype: {
      id: string;
      name: string;
      iconUrl: string;
    };
    priority?: {
      name: string;
      iconUrl: string;
    };
    assignee?: {
      displayName: string;
      emailAddress: string;
      accountId: string;
    };
    reporter?: {
      displayName: string;
      emailAddress: string;
      accountId: string;
    };
    created: string;
    updated: string;
    project: {
      id: string;
      key: string;
      name: string;
    };
    labels?: string[];
    [key: string]: unknown;
  };
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  self: string;
  avatarUrls?: Record<string, string>;
  lead?: {
    displayName: string;
    accountId: string;
  };
}

export interface JiraIssueType {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  subtask: boolean;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: {
    id: string;
    name: string;
  };
}

export interface JiraComment {
  id: string;
  body: unknown;
  author?: {
    displayName: string;
    accountId: string;
  };
  created: string;
  updated: string;
}

function buildAdfDescription(text: string): Record<string, unknown> {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text,
          },
        ],
      },
    ],
  };
}

async function jiraFetch<T>(
  userId: string,
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await jiraService.getAccessToken(userId);
  if (!token) {
    throw new Error(
      "Not authenticated with Jira. Please connect your account.",
    );
  }

  const cloudId = getCloudId();
  if (!cloudId) {
    throw new Error("Jira cloud ID not configured. Please set JIRA_CLOUD_ID.");
  }

  const baseUrl =
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/${JIRA_API_VERSION}`;
  const url = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({} as unknown));
    const message = (error as any)?.errorMessages?.join(", ") ||
      (error as any)?.message ||
      response.statusText;

    throw new Error(`Jira API error: ${response.status} ${message}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

export async function searchIssues(
  userId: string,
  jql: string,
  options?: {
    fields?: string[];
    maxResults?: number;
    startAt?: number;
  },
): Promise<{ issues: JiraIssue[]; total: number }> {
  const params = new URLSearchParams({
    jql,
    maxResults: String(options?.maxResults ?? 50),
    startAt: String(options?.startAt ?? 0),
  });

  if (options?.fields?.length) {
    params.set("fields", options.fields.join(","));
  }

  const response = await jiraFetch<JiraResponse<JiraIssue>>(userId, `/search?${params.toString()}`);

  return {
    issues: response.issues ?? [],
    total: response.total ?? 0,
  };
}

export function getIssue(userId: string, issueIdOrKey: string): Promise<JiraIssue> {
  return jiraFetch<JiraIssue>(userId, `/issue/${issueIdOrKey}`);
}

export async function createIssue(userId: string, options: {
  projectKey: string;
  summary: string;
  description?: string;
  issueType: string;
  priority?: string;
  assigneeId?: string;
  labels?: string[];
}): Promise<JiraIssue> {
  const fields: Record<string, unknown> = {
    project: { key: options.projectKey },
    summary: options.summary,
    issuetype: { name: options.issueType },
  };

  if (options.description) {
    fields.description = buildAdfDescription(options.description);
  }

  if (options.priority) {
    fields.priority = { name: options.priority };
  }

  if (options.assigneeId) {
    fields.assignee = { id: options.assigneeId };
  }

  if (options.labels?.length) {
    fields.labels = options.labels;
  }

  const response = await jiraFetch<{ id: string; key: string; self: string }>(userId, "/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });

  return getIssue(userId, response.key);
}

export async function listComments(
  userId: string,
  issueIdOrKey: string,
  options?: { startAt?: number; maxResults?: number },
): Promise<
  {
    comments: JiraComment[];
    total: number;
    startAt: number;
    maxResults: number;
  }
> {
  const params = new URLSearchParams({
    startAt: String(options?.startAt ?? 0),
    maxResults: String(options?.maxResults ?? 50),
  });

  const response = await jiraFetch<{
    comments?: JiraComment[];
    total?: number;
    startAt?: number;
    maxResults?: number;
  }>(userId, `/issue/${issueIdOrKey}/comment?${params.toString()}`);

  return {
    comments: response.comments ?? [],
    total: response.total ?? 0,
    startAt: response.startAt ?? 0,
    maxResults: response.maxResults ?? 0,
  };
}

export function addComment(
  userId: string,
  issueIdOrKey: string,
  body: string,
): Promise<JiraComment> {
  return jiraFetch<JiraComment>(userId, `/issue/${issueIdOrKey}/comment`, {
    method: "POST",
    body: JSON.stringify({ body: buildAdfDescription(body) }),
  });
}

export function updateIssue(
  userId: string,
  issueIdOrKey: string,
  updates: {
    summary?: string;
    description?: string;
    priority?: string;
    assigneeId?: string;
    labels?: string[];
  },
): Promise<void> {
  const fields: Record<string, unknown> = {};

  if (updates.summary) {
    fields.summary = updates.summary;
  }

  if (updates.description) {
    fields.description = buildAdfDescription(updates.description);
  }

  if (updates.priority) {
    fields.priority = { name: updates.priority };
  }

  if (updates.assigneeId) {
    fields.assignee = { id: updates.assigneeId };
  }

  if (updates.labels) {
    fields.labels = updates.labels;
  }

  return jiraFetch<void>(userId, `/issue/${issueIdOrKey}`, {
    method: "PUT",
    body: JSON.stringify({ fields }),
  });
}

export async function transitionIssue(
  userId: string,
  issueIdOrKey: string,
  transitionId: string,
): Promise<void> {
  await jiraFetch<void>(userId, `/issue/${issueIdOrKey}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
}

export async function getIssueTransitions(
  userId: string,
  issueIdOrKey: string,
): Promise<JiraTransition[]> {
  const response = await jiraFetch<{ transitions: JiraTransition[] }>(
    userId,
    `/issue/${issueIdOrKey}/transitions`,
  );
  return response.transitions ?? [];
}

export async function listProjects(userId: string): Promise<JiraProject[]> {
  return jiraFetch<JiraProject[]>(userId, "/project");
}

export function getProject(userId: string, projectIdOrKey: string): Promise<JiraProject> {
  return jiraFetch<JiraProject>(userId, `/project/${projectIdOrKey}`);
}

export async function getProjectIssueTypes(
  userId: string,
  projectIdOrKey: string,
): Promise<JiraIssueType[]> {
  return jiraFetch<JiraIssueType[]>(userId, `/project/${projectIdOrKey}/statuses`);
}

export function extractDescriptionText(description: unknown): string {
  if (typeof description === "string") {
    return description;
  }

  if (!description || typeof description !== "object") {
    return "";
  }

  const content = (description as { content?: unknown[] }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  const texts: string[] = [];

  function extractText(node: any): void {
    if (node?.type === "text" && node.text) {
      texts.push(node.text);
    }

    if (Array.isArray(node?.content)) {
      node.content.forEach(extractText);
    }
  }

  content.forEach(extractText);
  return texts.join(" ");
}
