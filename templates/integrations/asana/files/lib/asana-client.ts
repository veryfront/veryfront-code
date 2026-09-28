import { asanaConfig, OAuthService } from "veryfront/oauth";
import { tokenStore } from "./token-store.ts";

// OAuthService refreshes expired tokens under the store's refresh lock.
const asanaService = new OAuthService(asanaConfig, tokenStore);

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
  userId: string,
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await asanaService.getAccessToken(userId);
  if (!token) {
    throw new Error("Not authenticated with Asana. Please connect your account.");
  }

  const response = await fetch(`${ASANA_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (response.ok) {
    return response.json();
  }

  let error: unknown = {};
  try {
    error = await response.json();
  } catch {
    // ignore JSON parse errors
  }

  const message =
    (error as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message ?? response.statusText;

  throw new Error(`Asana API error: ${response.status} ${message}`);
}

export async function listWorkspaces(userId: string): Promise<AsanaWorkspace[]> {
  const { data } = await asanaFetch<AsanaResponse<AsanaWorkspace[]>>(userId, "/workspaces");
  return data;
}

export async function listProjects(userId: string, workspaceGid: string): Promise<AsanaProject[]> {
  const { data } = await asanaFetch<AsanaResponse<AsanaProject[]>>(
    userId,
    `/workspaces/${workspaceGid}/projects?opt_fields=name,notes,created_at,modified_at`,
  );
  return data;
}

export async function listTasks(userId: string, options: {
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

  const { data } = await asanaFetch<AsanaResponse<AsanaTask[]>>(userId, `${endpoint}?${params}`);
  return data;
}

export async function getTask(userId: string, taskGid: string): Promise<AsanaTask> {
  const { data } = await asanaFetch<AsanaResponse<AsanaTask>>(
    userId,
    `/tasks/${taskGid}?opt_fields=name,notes,completed,due_on,assignee.name,projects.name,created_at,modified_at`,
  );
  return data;
}

export async function createTask(userId: string, options: {
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

  const { data } = await asanaFetch<AsanaResponse<AsanaTask>>(userId, "/tasks", {
    method: "POST",
    body: JSON.stringify({ data: body }),
  });

  return data;
}

export async function updateTask(
  userId: string,
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

  const { data } = await asanaFetch<AsanaResponse<AsanaTask>>(userId, `/tasks/${taskGid}`, {
    method: "PUT",
    body: JSON.stringify({ data: body }),
  });

  return data;
}

export async function getMe(userId: string): Promise<{ gid: string; name: string; email: string }> {
  const { data } = await asanaFetch<AsanaResponse<{ gid: string; name: string; email: string }>>(
    userId,
    "/users/me",
  );
  return data;
}

interface AsanaUser {
  gid: string;
  name: string;
  email?: string;
}

interface AsanaTeam {
  gid: string;
  name: string;
  description?: string;
}

interface AsanaStory {
  gid: string;
  type: string;
  text?: string;
  created_at: string;
  created_by?: { gid: string; name: string };
}

export async function listUsers(userId: string, options: {
  workspaceGid: string;
  teamGid?: string;
}): Promise<AsanaUser[]> {
  const params = new URLSearchParams({
    workspace: options.workspaceGid,
    opt_fields: "gid,name,email",
  });

  if (options.teamGid) params.set("team", options.teamGid);

  const { data } = await asanaFetch<AsanaResponse<AsanaUser[]>>(userId, `/users?${params}`);
  return data;
}

export async function listTeams(userId: string, workspaceGid: string): Promise<AsanaTeam[]> {
  const { data } = await asanaFetch<AsanaResponse<AsanaTeam[]>>(
    userId,
    `/workspaces/${workspaceGid}/teams?opt_fields=gid,name,description`,
  );
  return data;
}

export async function addTaskComment(userId: string, options: {
  taskGid: string;
  text: string;
}): Promise<AsanaStory> {
  const { data } = await asanaFetch<AsanaResponse<AsanaStory>>(
    userId,
    `/tasks/${options.taskGid}/stories`,
    {
      method: "POST",
      body: JSON.stringify({ data: { text: options.text } }),
    },
  );
  return data;
}

export async function listTaskComments(userId: string, taskGid: string): Promise<AsanaStory[]> {
  const params = new URLSearchParams({
    opt_fields: "gid,type,text,created_at,created_by.name",
  });
  const { data } = await asanaFetch<AsanaResponse<AsanaStory[]>>(
    userId,
    `/tasks/${taskGid}/stories?${params}`,
  );
  return data.filter((story) => story.type === "comment");
}
