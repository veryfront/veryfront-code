import { airtableConfig, OAuthService } from "veryfront/oauth";
import { tokenStore } from "./token-store.ts";

// OAuthService refreshes expired tokens under the store's refresh lock.
const airtableService = new OAuthService(airtableConfig, tokenStore);

const AIRTABLE_BASE_URL = "https://api.airtable.com/v0";
const AIRTABLE_META_BASE_URL = "https://api.airtable.com/v0/meta";

interface AirtableResponse<T> {
  records?: T[];
  offset?: string;
}

interface AirtableBase {
  id: string;
  name: string;
  permissionLevel: string;
}

interface AirtableBaseSchema {
  tables: Array<{
    id: string;
    name: string;
    primaryFieldId: string;
    fields: Array<{
      id: string;
      name: string;
      type: string;
      options?: Record<string, unknown>;
    }>;
    views: Array<{
      id: string;
      name: string;
      type: string;
    }>;
  }>;
}

export interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

export interface AirtableFieldDefinition {
  name: string;
  type: string;
  description?: string;
  options?: Record<string, unknown>;
}

export interface AirtableTableDefinition {
  id: string;
  name: string;
  primaryFieldId: string;
  fields: AirtableFieldDefinition[];
  views: Array<{
    id: string;
    name: string;
    type: string;
  }>;
}

async function getTokenOrThrow(userId: string): Promise<string> {
  const token = await airtableService.getAccessToken(userId);
  if (token) return token;
  throw new Error("Not authenticated with Airtable. Please connect your account.");
}

async function apiFetch<T>(
  userId: string,
  baseUrl: string,
  endpoint: string,
  options: RequestInit,
  errorPrefix: string,
): Promise<T> {
  const token = await getTokenOrThrow(userId);

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `${errorPrefix}: ${response.status} ${error?.error?.message ?? response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

function airtableFetch<T>(userId: string, endpoint: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(userId, AIRTABLE_BASE_URL, endpoint, options, "Airtable API error");
}

function metaFetch<T>(userId: string, endpoint: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(userId, AIRTABLE_META_BASE_URL, endpoint, options, "Airtable Meta API error");
}

export async function listBases(userId: string): Promise<AirtableBase[]> {
  const response = await metaFetch<{ bases: AirtableBase[] }>(userId, "/bases");
  return response.bases ?? [];
}

export function getBase(userId: string, baseId: string): Promise<AirtableBaseSchema> {
  return metaFetch<AirtableBaseSchema>(userId, `/bases/${baseId}/tables`);
}

export async function listRecords(
  userId: string,
  baseId: string,
  tableIdOrName: string,
  options?: {
    fields?: string[];
    filterByFormula?: string;
    maxRecords?: number;
    pageSize?: number;
    sort?: Array<{ field: string; direction: "asc" | "desc" }>;
    view?: string;
    offset?: string;
  },
): Promise<{ records: AirtableRecord[]; offset?: string }> {
  const params = new URLSearchParams();

  options?.fields?.forEach((field) => params.append("fields[]", field));
  if (options?.filterByFormula) params.append("filterByFormula", options.filterByFormula);
  if (options?.maxRecords) params.append("maxRecords", String(options.maxRecords));
  if (options?.pageSize) params.append("pageSize", String(options.pageSize));
  options?.sort?.forEach((s, i) => {
    params.append(`sort[${i}][field]`, s.field);
    params.append(`sort[${i}][direction]`, s.direction);
  });
  if (options?.view) params.append("view", options.view);
  if (options?.offset) params.append("offset", options.offset);

  const queryString = params.toString();
  const endpoint = `/${baseId}/${encodeURIComponent(tableIdOrName)}${
    queryString ? `?${queryString}` : ""
  }`;

  const response = await airtableFetch<AirtableResponse<AirtableRecord>>(userId, endpoint);

  return { records: response.records ?? [], offset: response.offset };
}

export function getRecord(
  userId: string,
  baseId: string,
  tableIdOrName: string,
  recordId: string,
): Promise<AirtableRecord> {
  return airtableFetch<AirtableRecord>(
    userId,
    `/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`,
  );
}

export function createRecord(
  userId: string,
  baseId: string,
  tableIdOrName: string,
  fields: Record<string, unknown>,
  options?: { typecast?: boolean },
): Promise<AirtableRecord> {
  return airtableFetch<AirtableRecord>(userId, `/${baseId}/${encodeURIComponent(tableIdOrName)}`, {
    method: "POST",
    body: JSON.stringify({ fields, typecast: options?.typecast }),
  });
}

export async function createRecords(
  userId: string,
  baseId: string,
  tableIdOrName: string,
  records: Array<{ fields: Record<string, unknown> }>,
  options?: { typecast?: boolean },
): Promise<AirtableRecord[]> {
  const response = await airtableFetch<{ records: AirtableRecord[] }>(
    userId,
    `/${baseId}/${encodeURIComponent(tableIdOrName)}`,
    {
      method: "POST",
      body: JSON.stringify({ records, typecast: options?.typecast }),
    },
  );

  return response.records;
}

export function updateRecord(
  userId: string,
  baseId: string,
  tableIdOrName: string,
  recordId: string,
  fields: Record<string, unknown>,
  options?: { destructive?: boolean; typecast?: boolean },
): Promise<AirtableRecord> {
  return airtableFetch<AirtableRecord>(
    userId,
    `/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`,
    {
      method: options?.destructive ? "PUT" : "PATCH",
      body: JSON.stringify({ fields, typecast: options?.typecast }),
    },
  );
}

export function deleteRecord(
  userId: string,
  baseId: string,
  tableIdOrName: string,
  recordId: string,
): Promise<{ id: string; deleted: boolean }> {
  return airtableFetch<{ id: string; deleted: boolean }>(
    userId,
    `/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`,
    { method: "DELETE" },
  );
}

export function createTable(
  userId: string,
  baseId: string,
  name: string,
  fields: AirtableFieldDefinition[],
  options?: { description?: string },
): Promise<AirtableTableDefinition> {
  return metaFetch<AirtableTableDefinition>(userId, `/bases/${baseId}/tables`, {
    method: "POST",
    body: JSON.stringify({ name, description: options?.description, fields }),
  });
}

export function updateTable(
  userId: string,
  baseId: string,
  tableId: string,
  updates: { name?: string; description?: string },
): Promise<AirtableTableDefinition> {
  return metaFetch<AirtableTableDefinition>(userId, `/bases/${baseId}/tables/${tableId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function createField(
  userId: string,
  baseId: string,
  tableId: string,
  field: AirtableFieldDefinition,
): Promise<AirtableFieldDefinition & { id: string }> {
  return metaFetch<AirtableFieldDefinition & { id: string }>(
    userId,
    `/bases/${baseId}/tables/${tableId}/fields`,
    {
      method: "POST",
      body: JSON.stringify(field),
    },
  );
}

export function formatFieldValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((v) => formatFieldValue(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
