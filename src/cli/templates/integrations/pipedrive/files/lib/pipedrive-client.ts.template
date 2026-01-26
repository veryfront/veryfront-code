import { getAccessToken } from "./token-store.ts";

const PIPEDRIVE_BASE_URL = "https://api.pipedrive.com/v1";

interface PipedriveResponse<T> {
  success: boolean;
  data: T;
  additional_data?: {
    pagination?: {
      start: number;
      limit: number;
      more_items_in_collection: boolean;
      next_start?: number;
    };
  };
}

interface PipedriveDeal {
  id: number;
  title: string;
  value: number;
  currency: string;
  status: string;
  stage_id: number;
  person_id: number | null;
  person_name: string | null;
  org_id: number | null;
  org_name: string | null;
  owner_name: string;
  expected_close_date: string | null;
  add_time: string;
  update_time: string;
  won_time: string | null;
  lost_time: string | null;
  close_time: string | null;
}

interface PipedrivePerson {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  email: Array<{ value: string; primary: boolean }>;
  phone: Array<{ value: string; primary: boolean }>;
  org_id: number | null;
  org_name: string | null;
  owner_id: number;
  owner_name: string;
  add_time: string;
  update_time: string;
}

interface PipedriveStage {
  id: number;
  name: string;
  order_nr: number;
  pipeline_id: number;
  pipeline_name: string;
}

async function pipedriveFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Pipedrive. Please connect your account.");
  }

  const url = new URL(`${PIPEDRIVE_BASE_URL}${endpoint}`);
  url.searchParams.set("api_token", token);

  const response = await fetch(url.toString(), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({} as { error?: string }));
    throw new Error(`Pipedrive API error: ${response.status} ${error.error ?? response.statusText}`);
  }

  return response.json();
}

function buildEndpoint(path: string, params: URLSearchParams): string {
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export async function listDeals(options?: {
  status?: "open" | "won" | "lost" | "all";
  ownerId?: number;
  stageId?: number;
  limit?: number;
}): Promise<PipedriveDeal[]> {
  const params = new URLSearchParams();

  if (options?.status) params.set("status", options.status);
  if (options?.ownerId) params.set("user_id", options.ownerId.toString());
  if (options?.stageId) params.set("stage_id", options.stageId.toString());
  if (options?.limit) params.set("limit", options.limit.toString());

  const endpoint = buildEndpoint("/deals", params);
  const response = await pipedriveFetch<PipedriveResponse<PipedriveDeal[]>>(endpoint);

  return response.data || [];
}

export async function getDeal(dealId: number): Promise<PipedriveDeal> {
  const response = await pipedriveFetch<PipedriveResponse<PipedriveDeal>>(`/deals/${dealId}`);
  return response.data;
}

export async function createDeal(options: {
  title: string;
  value?: number;
  currency?: string;
  personId?: number;
  orgId?: number;
  stageId?: number;
  expectedCloseDate?: string;
}): Promise<PipedriveDeal> {
  const body: Record<string, unknown> = { title: options.title };

  if (options.value !== undefined) body.value = options.value;
  if (options.currency) body.currency = options.currency;
  if (options.personId) body.person_id = options.personId;
  if (options.orgId) body.org_id = options.orgId;
  if (options.stageId) body.stage_id = options.stageId;
  if (options.expectedCloseDate) body.expected_close_date = options.expectedCloseDate;

  const response = await pipedriveFetch<PipedriveResponse<PipedriveDeal>>("/deals", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return response.data;
}

export async function updateDeal(
  dealId: number,
  updates: {
    title?: string;
    value?: number;
    status?: string;
    stageId?: number;
    personId?: number;
    orgId?: number;
    expectedCloseDate?: string;
  },
): Promise<PipedriveDeal> {
  const body: Record<string, unknown> = {};

  if (updates.title !== undefined) body.title = updates.title;
  if (updates.value !== undefined) body.value = updates.value;
  if (updates.status !== undefined) body.status = updates.status;
  if (updates.stageId !== undefined) body.stage_id = updates.stageId;
  if (updates.personId !== undefined) body.person_id = updates.personId;
  if (updates.orgId !== undefined) body.org_id = updates.orgId;
  if (updates.expectedCloseDate !== undefined) body.expected_close_date = updates.expectedCloseDate;

  const response = await pipedriveFetch<PipedriveResponse<PipedriveDeal>>(`/deals/${dealId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

  return response.data;
}

export async function listPersons(options?: {
  searchTerm?: string;
  limit?: number;
}): Promise<PipedrivePerson[]> {
  const params = new URLSearchParams();

  if (options?.searchTerm) params.set("term", options.searchTerm);
  if (options?.limit) params.set("limit", options.limit.toString());

  const endpoint = buildEndpoint("/persons", params);
  const response = await pipedriveFetch<PipedriveResponse<PipedrivePerson[]>>(endpoint);

  return response.data || [];
}

export async function getPerson(personId: number): Promise<PipedrivePerson> {
  const response = await pipedriveFetch<PipedriveResponse<PipedrivePerson>>(`/persons/${personId}`);
  return response.data;
}

export async function createPerson(options: {
  name: string;
  email?: string;
  phone?: string;
  orgId?: number;
}): Promise<PipedrivePerson> {
  const body: Record<string, unknown> = { name: options.name };

  if (options.email) body.email = [{ value: options.email, primary: true }];
  if (options.phone) body.phone = [{ value: options.phone, primary: true }];
  if (options.orgId) body.org_id = options.orgId;

  const response = await pipedriveFetch<PipedriveResponse<PipedrivePerson>>("/persons", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return response.data;
}

export async function listStages(): Promise<PipedriveStage[]> {
  const response = await pipedriveFetch<PipedriveResponse<PipedriveStage[]>>("/stages");
  return response.data || [];
}

export async function getCurrentUser(): Promise<{ id: number; name: string; email: string }> {
  const response = await pipedriveFetch<
    PipedriveResponse<{ id: number; name: string; email: string }>
  >("/users/me");
  return response.data;
}
