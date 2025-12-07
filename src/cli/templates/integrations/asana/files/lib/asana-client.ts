import { getAccessToken } from "./token-store.ts";

const ASANA_BASE_URL = "https://app.asana.com/api/1.0";

interface AsanaResponse<T> {
  data: T;
  next_page?: { offset: string } | null;
}

interface AsanaTask {
  gid: string;
  name: string;
  notes: string;
  completed: boolean;
  due_on: string | null;
  assignee: { gid: string; name: string } | null;
  projects: Array<{ gid: string; name: string }>;
  created_at: string;
  modified_at: string;
}

interface AsanaProject {
  gid: string;
  name: string;
  notes: string;
  workspace: { gid: string; name: string };
  created_at: string;
  modified_at: string;
}

interface AsanaWorkspace {
  gid: string;
  name: string;
}

async function asanaFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Asana. Please connect your account.");
  }

  const response = await fetch(`${ASANA_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Asana API error: ${response.status} ${error.errors?.[0]?.message || response.statusText}`,
    );
  }

  return response.json();
}

export async function listWorkspaces(): Promise<AsanaWorkspace[]> {
  const response = await asanaFetch<AsanaResponse<AsanaWorkspace[]>>("/workspaces");
  return response.data;
}

export async function listProjects(workspaceGid: string): Promise<AsanaProject[]> {
  const response = await asanaFetch<AsanaResponse<AsanaProject[]>>(
    `/workspaces/${workspaceGid}/projects?opt_fields=name,notes,created_at,modified_at`,
  );
  return response.data;
}

export async function listTasks(options: {
  projectGid?: string;
  assigneeGid?: string;
  workspaceGid?: string;
  completedSince?: string;
}): Promise<AsanaTask[]> {
  const params = new URLSearchParams({
    opt_fields: "name,notes,completed,due_on,assignee.name,projects.name,created_at,modified_at",
  });

  if (options.completedSince) {
    params.set("completed_since", options.completedSince);
  }

  let endpoint = "/tasks";
  if (options.projectGid) {
    endpoint = `/projects/${options.projectGid}/tasks`;
  } else if (options.assigneeGid && options.workspaceGid) {
    params.set("assignee", options.assigneeGid);
    params.set("workspace", options.workspaceGid);
  }

  const response = await asanaFetch<AsanaResponse<AsanaTask[]>>(`${endpoint}?${params}`);
  return response.data;
}

export async function getTask(taskGid: string): Promise<AsanaTask> {
  const response = await asanaFetch<AsanaResponse<AsanaTask>>(
    `/tasks/${taskGid}?opt_fields=name,notes,completed,due_on,assignee.name,projects.name,created_at,modified_at`,
  );
  return response.data;
}

export async function createTask(options: {
  projectGid: string;
  name: string;
  notes?: string;
  dueOn?: string;
  assigneeGid?: string;
}): Promise<AsanaTask> {
  const body: Record<string, unknown> = {
    name: options.name,
    projects: [options.projectGid],
  };

  if (options.notes) body.notes = options.notes;
  if (options.dueOn) body.due_on = options.dueOn;
  if (options.assigneeGid) body.assignee = options.assigneeGid;

  const response = await asanaFetch<AsanaResponse<AsanaTask>>("/tasks", {
    method: "POST",
    body: JSON.stringify({ data: body }),
  });
  return response.data;
}

export async function updateTask(
  taskGid: string,
  updates: {
    name?: string;
    notes?: string;
    completed?: boolean;
    dueOn?: string;
    assigneeGid?: string;
  },
): Promise<AsanaTask> {
  const body: Record<string, unknown> = {};

  if (updates.name !== undefined) body.name = updates.name;
  if (updates.notes !== undefined) body.notes = updates.notes;
  if (updates.completed !== undefined) body.completed = updates.completed;
  if (updates.dueOn !== undefined) body.due_on = updates.dueOn;
  if (updates.assigneeGid !== undefined) body.assignee = updates.assigneeGid;

  const response = await asanaFetch<AsanaResponse<AsanaTask>>(`/tasks/${taskGid}`, {
    method: "PUT",
    body: JSON.stringify({ data: body }),
  });
  return response.data;
}

export async function getMe(): Promise<{ gid: string; name: string; email: string }> {
  const response = await asanaFetch<AsanaResponse<{ gid: string; name: string; email: string }>>(
    "/users/me",
  );
  return response.data;
}
