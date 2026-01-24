import { getAccessToken } from "./token-store.ts";

const CLICKUP_BASE_URL = "https://api.clickup.com/api/v2";

interface ClickUpTask {
  id: string;
  name: string;
  description: string;
  status: {
    status: string;
    color: string;
    type: string;
  };
  date_created: string;
  date_updated: string;
  date_closed: string | null;
  creator: {
    id: number;
    username: string;
    email: string;
  };
  assignees: Array<{
    id: number;
    username: string;
    email: string;
  }>;
  tags: Array<{
    name: string;
    tag_fg: string;
    tag_bg: string;
  }>;
  due_date: string | null;
  start_date: string | null;
  priority: {
    id: string;
    priority: string;
    color: string;
  } | null;
  list: {
    id: string;
    name: string;
  };
  folder: {
    id: string;
    name: string;
  };
  space: {
    id: string;
    name: string;
  };
}

interface ClickUpList {
  id: string;
  name: string;
  orderindex: number;
  content: string;
  status: {
    status: string;
    color: string;
  };
  priority: {
    priority: string;
    color: string;
  } | null;
  assignee: {
    id: number;
    username: string;
    email: string;
  } | null;
  task_count: number;
  due_date: string | null;
  start_date: string | null;
  folder: {
    id: string;
    name: string;
    hidden: boolean;
    access: boolean;
  };
  space: {
    id: string;
    name: string;
    access: boolean;
  };
  archived: boolean;
}

interface ClickUpFolder {
  id: string;
  name: string;
  orderindex: number;
  override_statuses: boolean;
  hidden: boolean;
  space: {
    id: string;
    name: string;
  };
  task_count: string;
  lists: ClickUpList[];
}

interface ClickUpSpace {
  id: string;
  name: string;
  private: boolean;
  statuses: Array<{
    status: string;
    type: string;
    orderindex: number;
    color: string;
  }>;
  multiple_assignees: boolean;
  features: {
    due_dates: {
      enabled: boolean;
      start_date: boolean;
      remap_due_dates: boolean;
      remap_closed_due_date: boolean;
    };
    time_tracking: {
      enabled: boolean;
    };
    tags: {
      enabled: boolean;
    };
    time_estimates: {
      enabled: boolean;
    };
    checklists: {
      enabled: boolean;
    };
    custom_fields: {
      enabled: boolean;
    };
    remap_dependencies: {
      enabled: boolean;
    };
    dependency_warning: {
      enabled: boolean;
    };
    portfolios: {
      enabled: boolean;
    };
  };
}

function buildCustomTaskParams(options?: {
  customTaskIds?: boolean;
  teamId?: string;
}): URLSearchParams {
  const params = new URLSearchParams();

  if (options?.customTaskIds) {
    params.set("custom_task_ids", "true");
    if (options.teamId) params.set("team_id", options.teamId);
  }

  return params;
}

function withQuery(endpoint: string, params: URLSearchParams): string {
  const queryString = params.toString();
  return queryString ? `${endpoint}?${queryString}` : endpoint;
}

async function clickupFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with ClickUp. Please connect your account.");
  }

  const response = await fetch(`${CLICKUP_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({} as Record<string, unknown>));
    const message =
      (error as { err?: string; error?: string }).err ??
      (error as { err?: string; error?: string }).error ??
      response.statusText;

    throw new Error(`ClickUp API error: ${response.status} ${message}`);
  }

  return response.json();
}

export async function listSpaces(teamId: string): Promise<ClickUpSpace[]> {
  const response = await clickupFetch<{ spaces: ClickUpSpace[] }>(`/team/${teamId}/space`);
  return response.spaces;
}

export async function listFolders(spaceId: string): Promise<ClickUpFolder[]> {
  const response = await clickupFetch<{ folders: ClickUpFolder[] }>(`/space/${spaceId}/folder`);
  return response.folders;
}

export async function listLists(folderId: string): Promise<ClickUpList[]> {
  const response = await clickupFetch<{ lists: ClickUpList[] }>(`/folder/${folderId}/list`);
  return response.lists;
}

export async function listFolderlessLists(spaceId: string): Promise<ClickUpList[]> {
  const response = await clickupFetch<{ lists: ClickUpList[] }>(`/space/${spaceId}/list`);
  return response.lists;
}

export async function listTasks(options: {
  listId?: string;
  spaceId?: string;
  folderId?: string;
  assignees?: number[];
  statuses?: string[];
  includeClosed?: boolean;
  orderBy?: string;
  subtasks?: boolean;
}): Promise<ClickUpTask[]> {
  const params = new URLSearchParams();

  options.assignees?.forEach((assignee) => params.append("assignees[]", assignee.toString()));
  options.statuses?.forEach((status) => params.append("statuses[]", status));

  if (options.includeClosed !== undefined) params.set("include_closed", options.includeClosed.toString());
  if (options.orderBy) params.set("order_by", options.orderBy);
  if (options.subtasks !== undefined) params.set("subtasks", options.subtasks.toString());

  let endpoint = "/task";
  if (options.listId) endpoint = `/list/${options.listId}/task`;
  else if (options.folderId) endpoint = `/folder/${options.folderId}/task`;
  else if (options.spaceId) endpoint = `/space/${options.spaceId}/task`;

  const response = await clickupFetch<{ tasks: ClickUpTask[] }>(withQuery(endpoint, params));
  return response.tasks;
}

export async function getTask(
  taskId: string,
  options?: {
    customTaskIds?: boolean;
    teamId?: string;
    includeSubtasks?: boolean;
  },
): Promise<ClickUpTask> {
  const params = buildCustomTaskParams(options);

  if (options?.includeSubtasks) params.set("include_subtasks", "true");

  return clickupFetch<ClickUpTask>(withQuery(`/task/${taskId}`, params));
}

export async function createTask(options: {
  listId: string;
  name: string;
  description?: string;
  assignees?: number[];
  tags?: string[];
  status?: string;
  priority?: number;
  dueDate?: number;
  dueDateTime?: boolean;
  timeEstimate?: number;
  startDate?: number;
  startDateTime?: boolean;
  notifyAll?: boolean;
  parent?: string;
  linksTo?: string;
  checkRequired?: boolean;
  customTaskIds?: boolean;
  teamId?: string;
}): Promise<ClickUpTask> {
  const body: Record<string, unknown> = { name: options.name };

  if (options.description) body.description = options.description;
  if (options.assignees) body.assignees = options.assignees;
  if (options.tags) body.tags = options.tags;
  if (options.status) body.status = options.status;
  if (options.priority !== undefined) body.priority = options.priority;

  if (options.dueDate) {
    body.due_date = options.dueDate;
    if (options.dueDateTime !== undefined) body.due_date_time = options.dueDateTime;
  }

  if (options.timeEstimate) body.time_estimate = options.timeEstimate;

  if (options.startDate) {
    body.start_date = options.startDate;
    if (options.startDateTime !== undefined) body.start_date_time = options.startDateTime;
  }

  if (options.notifyAll !== undefined) body.notify_all = options.notifyAll;
  if (options.parent) body.parent = options.parent;
  if (options.linksTo) body.links_to = options.linksTo;

  const url = withQuery(`/list/${options.listId}/task`, buildCustomTaskParams(options));

  return clickupFetch<ClickUpTask>(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTask(
  taskId: string,
  updates: {
    name?: string;
    description?: string;
    status?: string;
    priority?: number | null;
    dueDate?: number | null;
    dueDateTime?: boolean;
    timeEstimate?: number | null;
    startDate?: number | null;
    startDateTime?: boolean;
    assignees?: {
      add?: number[];
      rem?: number[];
    };
    archived?: boolean;
  },
  options?: {
    customTaskIds?: boolean;
    teamId?: string;
  },
): Promise<ClickUpTask> {
  const body: Record<string, unknown> = {};

  if (updates.name !== undefined) body.name = updates.name;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.status !== undefined) body.status = updates.status;
  if (updates.priority !== undefined) body.priority = updates.priority;

  if (updates.dueDate !== undefined) {
    body.due_date = updates.dueDate;
    if (updates.dueDateTime !== undefined) body.due_date_time = updates.dueDateTime;
  }

  if (updates.timeEstimate !== undefined) body.time_estimate = updates.timeEstimate;

  if (updates.startDate !== undefined) {
    body.start_date = updates.startDate;
    if (updates.startDateTime !== undefined) body.start_date_time = updates.startDateTime;
  }

  if (updates.assignees) body.assignees = updates.assignees;
  if (updates.archived !== undefined) body.archived = updates.archived;

  const url = withQuery(`/task/${taskId}`, buildCustomTaskParams(options));

  return clickupFetch<ClickUpTask>(url, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function getAuthorizedUser(): Promise<{
  user: {
    id: number;
    username: string;
    email: string;
    color: string;
    profilePicture: string;
  };
}> {
  return clickupFetch<{
    user: {
      id: number;
      username: string;
      email: string;
      color: string;
      profilePicture: string;
    };
  }>("/user");
}

export async function getTeams(): Promise<
  Array<{
    id: string;
    name: string;
    color: string;
    avatar: string | null;
    members: Array<{
      user: {
        id: number;
        username: string;
        email: string;
      };
    }>;
  }>
> {
  const response = await clickupFetch<{
    teams: Array<{
      id: string;
      name: string;
      color: string;
      avatar: string | null;
      members: Array<{
        user: {
          id: number;
          username: string;
          email: string;
        };
      }>;
    }>;
  }>("/team");

  return response.teams;
}
