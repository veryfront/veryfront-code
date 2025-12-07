import { getAccessToken, getCloudId } from "./token-store.ts";

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
    description?: {
      type: string;
      content: unknown[];
    } | string;
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

async function jiraFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  const cloudId = await getCloudId();

  if (!token) {
    throw new Error("Not authenticated with Jira. Please connect your account.");
  }

  if (!cloudId) {
    throw new Error("Jira cloud ID not found. Please reconnect your account.");
  }

  const baseUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/${JIRA_API_VERSION}`;
  const url = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Jira API error: ${response.status} ${
        error.errorMessages?.join(", ") || error.message || response.statusText
      }`,
    );
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

export async function searchIssues(
  jql: string,
  options?: {
    fields?: string[];
    maxResults?: number;
    startAt?: number;
  },
): Promise<{ issues: JiraIssue[]; total: number }> {
  const params = new URLSearchParams({
    jql,
    maxResults: String(options?.maxResults || 50),
    startAt: String(options?.startAt || 0),
  });

  if (options?.fields && options.fields.length > 0) {
    params.set("fields", options.fields.join(","));
  }

  const response = await jiraFetch<JiraResponse<JiraIssue>>(
    `/search?${params.toString()}`,
  );

  return {
    issues: response.issues || [],
    total: response.total || 0,
  };
}

export async function getIssue(issueIdOrKey: string): Promise<JiraIssue> {
  return jiraFetch<JiraIssue>(`/issue/${issueIdOrKey}`);
}

export async function createIssue(options: {
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
    // Use ADF (Atlassian Document Format) for description
    fields.description = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: options.description,
            },
          ],
        },
      ],
    };
  }

  if (options.priority) {
    fields.priority = { name: options.priority };
  }

  if (options.assigneeId) {
    fields.assignee = { id: options.assigneeId };
  }

  if (options.labels && options.labels.length > 0) {
    fields.labels = options.labels;
  }

  const response = await jiraFetch<{ id: string; key: string; self: string }>(
    "/issue",
    {
      method: "POST",
      body: JSON.stringify({ fields }),
    },
  );

  // Fetch the full issue details
  return getIssue(response.key);
}

export async function updateIssue(
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
    fields.description = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: updates.description,
            },
          ],
        },
      ],
    };
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

  await jiraFetch<void>(`/issue/${issueIdOrKey}`, {
    method: "PUT",
    body: JSON.stringify({ fields }),
  });
}

export async function transitionIssue(
  issueIdOrKey: string,
  transitionId: string,
): Promise<void> {
  await jiraFetch<void>(`/issue/${issueIdOrKey}/transitions`, {
    method: "POST",
    body: JSON.stringify({
      transition: { id: transitionId },
    }),
  });
}

export async function getIssueTransitions(issueIdOrKey: string): Promise<JiraTransition[]> {
  const response = await jiraFetch<{ transitions: JiraTransition[] }>(
    `/issue/${issueIdOrKey}/transitions`,
  );
  return response.transitions || [];
}

export async function listProjects(): Promise<JiraProject[]> {
  const response = await jiraFetch<JiraProject[]>("/project");
  return response;
}

export async function getProject(projectIdOrKey: string): Promise<JiraProject> {
  return jiraFetch<JiraProject>(`/project/${projectIdOrKey}`);
}

export async function getProjectIssueTypes(projectIdOrKey: string): Promise<JiraIssueType[]> {
  const response = await jiraFetch<JiraIssueType[]>(
    `/project/${projectIdOrKey}/statuses`,
  );
  return response;
}

// Helper to extract plain text from ADF description
export function extractDescriptionText(description: unknown): string {
  if (typeof description === "string") {
    return description;
  }

  if (description && typeof description === "object" && "content" in description) {
    const content = (description as { content: unknown[] }).content;
    const texts: string[] = [];

    function extractText(node: any): void {
      if (node.type === "text" && node.text) {
        texts.push(node.text);
      }
      if (node.content && Array.isArray(node.content)) {
        node.content.forEach(extractText);
      }
    }

    content.forEach(extractText);
    return texts.join(" ");
  }

  return "";
}
