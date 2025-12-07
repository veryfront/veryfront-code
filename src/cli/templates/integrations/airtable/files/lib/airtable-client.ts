import { getAccessToken } from "./token-store.ts";

const AIRTABLE_BASE_URL = "https://api.airtable.com/v0";

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

interface AirtableField {
  id: string;
  name: string;
  type: string;
  options?: Record<string, unknown>;
}

async function airtableFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Airtable. Please connect your account.");
  }

  const response = await fetch(`${AIRTABLE_BASE_URL}${endpoint}`, {
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
      `Airtable API error: ${response.status} ${error.error?.message || response.statusText}`,
    );
  }

  return response.json();
}

// Meta API for listing bases
async function metaFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Airtable. Please connect your account.");
  }

  const response = await fetch(`https://api.airtable.com/v0/meta${endpoint}`, {
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
      `Airtable Meta API error: ${response.status} ${error.error?.message || response.statusText}`,
    );
  }

  return response.json();
}

export async function listBases(): Promise<AirtableBase[]> {
  const response = await metaFetch<{ bases: AirtableBase[] }>("/bases");
  return response.bases || [];
}

export async function getBase(baseId: string): Promise<AirtableBaseSchema> {
  const response = await metaFetch<AirtableBaseSchema>(`/bases/${baseId}/tables`);
  return response;
}

export async function listRecords(
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

  if (options?.fields) {
    options.fields.forEach((field) => params.append("fields[]", field));
  }
  if (options?.filterByFormula) {
    params.append("filterByFormula", options.filterByFormula);
  }
  if (options?.maxRecords) {
    params.append("maxRecords", options.maxRecords.toString());
  }
  if (options?.pageSize) {
    params.append("pageSize", options.pageSize.toString());
  }
  if (options?.sort) {
    options.sort.forEach((s, i) => {
      params.append(`sort[${i}][field]`, s.field);
      params.append(`sort[${i}][direction]`, s.direction);
    });
  }
  if (options?.view) {
    params.append("view", options.view);
  }
  if (options?.offset) {
    params.append("offset", options.offset);
  }

  const queryString = params.toString();
  const endpoint = `/${baseId}/${encodeURIComponent(tableIdOrName)}${
    queryString ? `?${queryString}` : ""
  }`;

  const response = await airtableFetch<AirtableResponse<AirtableRecord>>(endpoint);

  return {
    records: response.records || [],
    offset: response.offset,
  };
}

export function getRecord(
  baseId: string,
  tableIdOrName: string,
  recordId: string,
): Promise<AirtableRecord> {
  return airtableFetch<AirtableRecord>(
    `/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`,
  );
}

export function createRecord(
  baseId: string,
  tableIdOrName: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  return airtableFetch<AirtableRecord>(
    `/${baseId}/${encodeURIComponent(tableIdOrName)}`,
    {
      method: "POST",
      body: JSON.stringify({ fields }),
    },
  );
}

export async function createRecords(
  baseId: string,
  tableIdOrName: string,
  records: Array<{ fields: Record<string, unknown> }>,
): Promise<AirtableRecord[]> {
  const response = await airtableFetch<{ records: AirtableRecord[] }>(
    `/${baseId}/${encodeURIComponent(tableIdOrName)}`,
    {
      method: "POST",
      body: JSON.stringify({ records }),
    },
  );
  return response.records;
}

export function updateRecord(
  baseId: string,
  tableIdOrName: string,
  recordId: string,
  fields: Record<string, unknown>,
  options?: { destructive?: boolean },
): Promise<AirtableRecord> {
  return airtableFetch<AirtableRecord>(
    `/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`,
    {
      method: options?.destructive ? "PUT" : "PATCH",
      body: JSON.stringify({ fields }),
    },
  );
}

export function deleteRecord(
  baseId: string,
  tableIdOrName: string,
  recordId: string,
): Promise<{ id: string; deleted: boolean }> {
  return airtableFetch<{ id: string; deleted: boolean }>(
    `/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`,
    { method: "DELETE" },
  );
}

// Helper to format field value for display
export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((v) => formatFieldValue(v)).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
