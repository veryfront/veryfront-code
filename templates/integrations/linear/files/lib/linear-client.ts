import { getAccessToken } from "./token-store.ts";

const LINEAR_API_URL = "https://api.linear.app/graphql";

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: number;
  priorityLabel: string;
  state: {
    id: string;
    name: string;
    type: string;
  };
  assignee?: {
    id: string;
    name: string;
    email: string;
  };
  team: {
    id: string;
    name: string;
    key: string;
  };
  project?: {
    id: string;
    name: string;
  };
  labels: {
    nodes: Array<{
      id: string;
      name: string;
      color: string;
    }>;
  };
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface LinearProject {
  id: string;
  name: string;
  description?: string;
  state: string;
  progress: number;
  url: string;
  lead?: {
    id: string;
    name: string;
  };
  teams: {
    nodes: Array<{
      id: string;
      name: string;
      key: string;
    }>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
}

export interface LinearUser {
  id: string;
  name: string;
  displayName?: string;
  email: string;
  active: boolean;
  avatarUrl?: string;
}

export interface LinearComment {
  id: string;
  body: string;
  createdAt: string;
  user?: {
    id: string;
    name: string;
  };
  issue?: {
    id: string;
    identifier: string;
    title: string;
  };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    path?: string[];
  }>;
}

async function linearFetch<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Linear. Please connect your account.");
  }

  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
  }

  const json: GraphQLResponse<T> = await response.json();

  const errorMessage = json.errors?.[0]?.message;
  if (errorMessage) {
    throw new Error(`Linear GraphQL error: ${errorMessage}`);
  }

  if (!json.data) {
    throw new Error("Linear API returned no data");
  }

  return json.data;
}

export async function searchIssues(
  query: string,
  options?: {
    limit?: number;
    includeArchived?: boolean;
  },
): Promise<LinearIssue[]> {
  const gqlQuery = `
    query SearchIssues($query: String!, $first: Int, $includeArchived: Boolean) {
      issueSearch(query: $query, first: $first, includeArchived: $includeArchived) {
        nodes {
          id
          identifier
          title
          description
          priority
          priorityLabel
          state {
            id
            name
            type
          }
          assignee {
            id
            name
            email
          }
          team {
            id
            name
            key
          }
          project {
            id
            name
          }
          labels {
            nodes {
              id
              name
              color
            }
          }
          createdAt
          updatedAt
          url
        }
      }
    }
  `;

  const data = await linearFetch<{ issueSearch: { nodes: LinearIssue[] } }>(gqlQuery, {
    query,
    first: options?.limit ?? 10,
    includeArchived: options?.includeArchived ?? false,
  });

  return data.issueSearch.nodes;
}

export async function getIssue(issueId: string): Promise<LinearIssue> {
  const query = `
    query GetIssue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        priority
        priorityLabel
        state {
          id
          name
          type
        }
        assignee {
          id
          name
          email
        }
        team {
          id
          name
          key
        }
        project {
          id
          name
        }
        labels {
          nodes {
            id
            name
            color
          }
        }
        createdAt
        updatedAt
        url
      }
    }
  `;

  const data = await linearFetch<{ issue: LinearIssue }>(query, { id: issueId });
  return data.issue;
}

export async function createIssue(options: {
  teamId: string;
  title: string;
  description?: string;
  priority?: number;
  stateId?: string;
  assigneeId?: string;
  projectId?: string;
  labelIds?: string[];
}): Promise<LinearIssue> {
  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          description
          priority
          priorityLabel
          state {
            id
            name
            type
          }
          assignee {
            id
            name
            email
          }
          team {
            id
            name
            key
          }
          project {
            id
            name
          }
          labels {
            nodes {
              id
              name
              color
            }
          }
          createdAt
          updatedAt
          url
        }
      }
    }
  `;

  const input: Record<string, unknown> = {
    teamId: options.teamId,
    title: options.title,
  };

  if (options.description) input.description = options.description;
  if (options.priority !== undefined) input.priority = options.priority;
  if (options.stateId) input.stateId = options.stateId;
  if (options.assigneeId) input.assigneeId = options.assigneeId;
  if (options.projectId) input.projectId = options.projectId;
  if (options.labelIds?.length) input.labelIds = options.labelIds;

  const data = await linearFetch<{ issueCreate: { success: boolean; issue: LinearIssue } }>(mutation, {
    input,
  });

  if (!data.issueCreate.success) {
    throw new Error("Failed to create issue");
  }

  return data.issueCreate.issue;
}

export async function updateIssue(
  issueId: string,
  options: {
    title?: string;
    description?: string;
    priority?: number;
    stateId?: string;
    assigneeId?: string;
    projectId?: string;
    labelIds?: string[];
  },
): Promise<LinearIssue> {
  const mutation = `
    mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          identifier
          title
          description
          priority
          priorityLabel
          state {
            id
            name
            type
          }
          assignee {
            id
            name
            email
          }
          team {
            id
            name
            key
          }
          project {
            id
            name
            }
          labels {
            nodes {
              id
              name
              color
            }
          }
          createdAt
          updatedAt
          url
        }
      }
    }
  `;

  const input: Record<string, unknown> = {};

  if (options.title) input.title = options.title;
  if (options.description !== undefined) input.description = options.description;
  if (options.priority !== undefined) input.priority = options.priority;
  if (options.stateId) input.stateId = options.stateId;
  if (options.assigneeId) input.assigneeId = options.assigneeId;
  if (options.projectId) input.projectId = options.projectId;
  if (options.labelIds) input.labelIds = options.labelIds;

  const data = await linearFetch<{ issueUpdate: { success: boolean; issue: LinearIssue } }>(mutation, {
    id: issueId,
    input,
  });

  if (!data.issueUpdate.success) {
    throw new Error("Failed to update issue");
  }

  return data.issueUpdate.issue;
}

export async function listProjects(options?: {
  limit?: number;
  includeArchived?: boolean;
}): Promise<LinearProject[]> {
  const query = `
    query ListProjects($first: Int, $includeArchived: Boolean) {
      projects(first: $first, includeArchived: $includeArchived) {
        nodes {
          id
          name
          description
          state
          progress
          url
          lead {
            id
            name
          }
          teams {
            nodes {
              id
              name
              key
            }
          }
          createdAt
          updatedAt
        }
      }
    }
  `;

  const data = await linearFetch<{ projects: { nodes: LinearProject[] } }>(query, {
    first: options?.limit ?? 20,
    includeArchived: options?.includeArchived ?? false,
  });

  return data.projects.nodes;
}

export async function getTeams(): Promise<LinearTeam[]> {
  const query = `
    query GetTeams {
      teams {
        nodes {
          id
          name
          key
        }
      }
    }
  `;

  const data = await linearFetch<{ teams: { nodes: LinearTeam[] } }>(query);
  return data.teams.nodes;
}

export async function getWorkflowStates(teamId: string): Promise<LinearWorkflowState[]> {
  const query = `
    query GetWorkflowStates($teamId: String!) {
      team(id: $teamId) {
        states {
          nodes {
            id
            name
            type
          }
        }
      }
    }
  `;

  const data = await linearFetch<{ team: { states: { nodes: LinearWorkflowState[] } } }>(query, {
    teamId,
  });

  return data.team.states.nodes;
}

export async function listUsers(options?: {
  limit?: number;
}): Promise<LinearUser[]> {
  const query = `
    query ListUsers($first: Int) {
      users(first: $first) {
        nodes {
          id
          name
          displayName
          email
          active
          avatarUrl
        }
      }
    }
  `;

  const data = await linearFetch<{ users: { nodes: LinearUser[] } }>(query, {
    first: options?.limit ?? 50,
  });

  return data.users.nodes;
}

export async function addComment(options: {
  issueId: string;
  body: string;
}): Promise<LinearComment> {
  const mutation = `
    mutation AddComment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
        comment {
          id
          body
          createdAt
          user {
            id
            name
          }
          issue {
            id
            identifier
            title
          }
        }
      }
    }
  `;

  const data = await linearFetch<{ commentCreate: { success: boolean; comment: LinearComment } }>(
    mutation,
    options,
  );

  if (!data.commentCreate.success) {
    throw new Error("Failed to add comment");
  }

  return data.commentCreate.comment;
}
