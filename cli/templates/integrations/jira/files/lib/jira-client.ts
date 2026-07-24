import { atlassianOAuthScopePolicy } from "./atlassian-oauth.generated.ts";
import { resolveAtlassianCloudId } from "./atlassian-cloud.ts";
import { fetchOAuthJsonWithScopePolicy } from "./oauth.ts";

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

export function createJiraClient(userId: string) {
  const cloudId = resolveAtlassianCloudId(
    userId,
    "jira",
    atlassianOAuthScopePolicy,
  );

  async function jiraFetch<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const resolvedCloudId = await cloudId;

    const baseUrl =
      `https://api.atlassian.com/ex/jira/${resolvedCloudId}/rest/api/${JIRA_API_VERSION}`;
    const url = `${baseUrl}${endpoint}`;

    return await fetchOAuthJsonWithScopePolicy<T>(
      userId,
      "jira",
      url,
      atlassianOAuthScopePolicy,
      {
        ...options,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...options.headers,
        },
      },
    );
  }

  async function searchIssues(
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

    const response = await jiraFetch<JiraResponse<JiraIssue>>(
      `/search?${params.toString()}`,
    );

    return {
      issues: response.issues ?? [],
      total: response.total ?? 0,
    };
  }

  function getIssue(issueIdOrKey: string): Promise<JiraIssue> {
    return jiraFetch<JiraIssue>(`/issue/${issueIdOrKey}`);
  }

  async function createIssue(options: {
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

    const response = await jiraFetch<{ id: string; key: string; self: string }>(
      "/issue",
      {
        method: "POST",
        body: JSON.stringify({ fields }),
      },
    );

    return getIssue(response.key);
  }

  async function listComments(
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
    }>(`/issue/${issueIdOrKey}/comment?${params.toString()}`);

    return {
      comments: response.comments ?? [],
      total: response.total ?? 0,
      startAt: response.startAt ?? 0,
      maxResults: response.maxResults ?? 0,
    };
  }

  function addComment(
    issueIdOrKey: string,
    body: string,
  ): Promise<JiraComment> {
    return jiraFetch<JiraComment>(`/issue/${issueIdOrKey}/comment`, {
      method: "POST",
      body: JSON.stringify({ body: buildAdfDescription(body) }),
    });
  }

  function updateIssue(
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

    return jiraFetch<void>(`/issue/${issueIdOrKey}`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    });
  }

  async function transitionIssue(
    issueIdOrKey: string,
    transitionId: string,
  ): Promise<void> {
    await jiraFetch<void>(`/issue/${issueIdOrKey}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
  }

  async function getIssueTransitions(
    issueIdOrKey: string,
  ): Promise<JiraTransition[]> {
    const response = await jiraFetch<{ transitions: JiraTransition[] }>(
      `/issue/${issueIdOrKey}/transitions`,
    );
    return response.transitions ?? [];
  }

  function listProjects(): Promise<JiraProject[]> {
    return jiraFetch<JiraProject[]>("/project");
  }

  function getProject(projectIdOrKey: string): Promise<JiraProject> {
    return jiraFetch<JiraProject>(`/project/${projectIdOrKey}`);
  }

  function getProjectIssueTypes(
    projectIdOrKey: string,
  ): Promise<JiraIssueType[]> {
    return jiraFetch<JiraIssueType[]>(`/project/${projectIdOrKey}/statuses`);
  }

  function extractDescriptionText(description: unknown): string {
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

    function extractText(node: unknown): void {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;

      if (record.type === "text" && typeof record.text === "string") {
        texts.push(record.text);
      }

      if (Array.isArray(record.content)) record.content.forEach(extractText);
    }

    content.forEach(extractText);
    return texts.join(" ");
  }

  return {
    searchIssues,
    getIssue,
    createIssue,
    listComments,
    addComment,
    updateIssue,
    transitionIssue,
    getIssueTransitions,
    listProjects,
    getProject,
    getProjectIssueTypes,
    extractDescriptionText,
  };
}
