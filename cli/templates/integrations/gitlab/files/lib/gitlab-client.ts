import { getAccessToken } from "./token-store.ts";

const GITLAB_BASE_URL = "https://gitlab.com/api/v4";

export interface GitLabProject {
  id: number;
  name: string;
  name_with_namespace: string;
  description: string | null;
  web_url: string;
  path_with_namespace: string;
  default_branch: string;
  visibility: "private" | "internal" | "public";
  created_at: string;
  last_activity_at: string;
}

export interface GitLabIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: "opened" | "closed";
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  labels: string[];
  milestone: {
    id: number;
    title: string;
  } | null;
  assignees: Array<{
    id: number;
    username: string;
    name: string;
    avatar_url: string;
  }>;
  author: {
    id: number;
    username: string;
    name: string;
    avatar_url: string;
  };
  web_url: string;
  time_stats: {
    time_estimate: number;
    total_time_spent: number;
  };
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: "opened" | "closed" | "merged";
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  target_branch: string;
  source_branch: string;
  author: {
    id: number;
    username: string;
    name: string;
    avatar_url: string;
  };
  assignees: Array<{
    id: number;
    username: string;
    name: string;
    avatar_url: string;
  }>;
  reviewers: Array<{
    id: number;
    username: string;
    name: string;
    avatar_url: string;
  }>;
  labels: string[];
  draft: boolean;
  web_url: string;
  changes_count: string;
  diff_refs: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
  };
}

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  email: string;
  avatar_url: string;
  web_url: string;
}

function encodeProjectId(projectId: number | string): number | string {
  return typeof projectId === "string" ? encodeURIComponent(projectId) : projectId;
}

function buildQuery(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function gitlabFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated with GitLab. Please connect your account.");

  const response = await fetch(`${GITLAB_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };

    const message = error.message ?? error.error ?? response.statusText;
    throw new Error(`GitLab API error: ${response.status} ${message}`);
  }

  return (await response.json()) as T;
}

export function getCurrentUser(): Promise<GitLabUser> {
  return gitlabFetch<GitLabUser>("/user");
}

export function listProjects(options?: {
  membership?: boolean;
  search?: string;
  orderBy?: "id" | "name" | "created_at" | "updated_at" | "last_activity_at";
  sort?: "asc" | "desc";
  perPage?: number;
}): Promise<GitLabProject[]> {
  const params = new URLSearchParams();

  if (options?.membership !== false) params.set("membership", "true");
  if (options?.search) params.set("search", options.search);
  if (options?.orderBy) params.set("order_by", options.orderBy);
  if (options?.sort) params.set("sort", options.sort);
  if (options?.perPage) params.set("per_page", options.perPage.toString());

  return gitlabFetch<GitLabProject[]>(`/projects${buildQuery(params)}`);
}

export function getProject(projectId: number | string): Promise<GitLabProject> {
  return gitlabFetch<GitLabProject>(`/projects/${encodeProjectId(projectId)}`);
}

export function searchIssues(options: {
  scope?: "created_by_me" | "assigned_to_me" | "all";
  state?: "opened" | "closed" | "all";
  labels?: string[];
  search?: string;
  projectId?: number | string;
  perPage?: number;
}): Promise<GitLabIssue[]> {
  const params = new URLSearchParams();

  if (options.scope) params.set("scope", options.scope);
  if (options.state) params.set("state", options.state);
  if (options.labels?.length) params.set("labels", options.labels.join(","));
  if (options.search) params.set("search", options.search);
  if (options.perPage) params.set("per_page", options.perPage.toString());

  const base = options.projectId
    ? `/projects/${encodeProjectId(options.projectId)}/issues`
    : "/issues";

  return gitlabFetch<GitLabIssue[]>(`${base}${buildQuery(params)}`);
}

export function getIssue(projectId: number | string, issueIid: number): Promise<GitLabIssue> {
  return gitlabFetch<GitLabIssue>(`/projects/${encodeProjectId(projectId)}/issues/${issueIid}`);
}

export function createIssue(
  projectId: number | string,
  options: {
    title: string;
    description?: string;
    labels?: string[];
    assigneeIds?: number[];
    milestoneId?: number;
    dueDate?: string;
  },
): Promise<GitLabIssue> {
  const body: Record<string, unknown> = { title: options.title };

  if (options.description) body.description = options.description;
  if (options.labels?.length) body.labels = options.labels.join(",");
  if (options.assigneeIds?.length) body.assignee_ids = options.assigneeIds;
  if (options.milestoneId) body.milestone_id = options.milestoneId;
  if (options.dueDate) body.due_date = options.dueDate;

  return gitlabFetch<GitLabIssue>(`/projects/${encodeProjectId(projectId)}/issues`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateIssue(
  projectId: number | string,
  issueIid: number,
  options: {
    title?: string;
    description?: string;
    state?: "opened" | "closed";
    labels?: string[];
    assigneeIds?: number[];
  },
): Promise<GitLabIssue> {
  const body: Record<string, unknown> = {};

  if (options.title) body.title = options.title;
  if (options.description !== undefined) body.description = options.description;
  if (options.state) body.state_event = options.state === "closed" ? "close" : "reopen";
  if (options.labels) body.labels = options.labels.join(",");
  if (options.assigneeIds) body.assignee_ids = options.assigneeIds;

  return gitlabFetch<GitLabIssue>(`/projects/${encodeProjectId(projectId)}/issues/${issueIid}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function listMergeRequests(options?: {
  scope?: "created_by_me" | "assigned_to_me" | "all";
  state?: "opened" | "closed" | "merged" | "all";
  labels?: string[];
  projectId?: number | string;
  perPage?: number;
}): Promise<GitLabMergeRequest[]> {
  const params = new URLSearchParams();

  if (options?.scope) params.set("scope", options.scope);
  if (options?.state) params.set("state", options.state);
  if (options?.labels?.length) params.set("labels", options.labels.join(","));
  if (options?.perPage) params.set("per_page", options.perPage.toString());

  const base = options?.projectId
    ? `/projects/${encodeProjectId(options.projectId)}/merge_requests`
    : "/merge_requests";

  return gitlabFetch<GitLabMergeRequest[]>(`${base}${buildQuery(params)}`);
}

export function getMergeRequest(
  projectId: number | string,
  mrIid: number,
): Promise<GitLabMergeRequest> {
  return gitlabFetch<GitLabMergeRequest>(
    `/projects/${encodeProjectId(projectId)}/merge_requests/${mrIid}`,
  );
}

export function formatIssueForDisplay(issue: GitLabIssue): string {
  const assignees = issue.assignees.map((a) => `@${a.username}`).join(", ");
  const labels = issue.labels.length ? `[${issue.labels.join(", ")}]` : "";

  return `#${issue.iid}: ${issue.title} ${labels}
State: ${issue.state}
Assignees: ${assignees || "None"}
Created: ${new Date(issue.created_at).toLocaleDateString()}
URL: ${issue.web_url}`;
}

export function formatMergeRequestForDisplay(mr: GitLabMergeRequest): string {
  const assignees = mr.assignees.map((a) => `@${a.username}`).join(", ");
  const reviewers = mr.reviewers.map((r) => `@${r.username}`).join(", ");
  const labels = mr.labels.length ? `[${mr.labels.join(", ")}]` : "";

  return `!${mr.iid}: ${mr.title} ${labels}
State: ${mr.state}${mr.draft ? " (Draft)" : ""}
Source: ${mr.source_branch} → Target: ${mr.target_branch}
Author: @${mr.author.username}
Assignees: ${assignees || "None"}
Reviewers: ${reviewers || "None"}
Created: ${new Date(mr.created_at).toLocaleDateString()}
URL: ${mr.web_url}`;
}
