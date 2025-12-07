import { getAnonKey, getServiceKey, getSupabaseUrl } from "./token-store.ts";

interface SupabaseResponse<T> {
  data: T | null;
  error: {
    message: string;
    details?: string;
    hint?: string;
    code?: string;
  } | null;
}

interface TableInfo {
  table_name: string;
  table_schema: string;
  table_type: string;
}

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface QueryOptions {
  select?: string;
  filter?: Record<string, unknown>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  offset?: number;
}

interface SupabaseError extends Error {
  code?: string;
  details?: string;
  hint?: string;
}

async function supabaseFetch<T>(
  endpoint: string,
  options: RequestInit = {},
  useServiceRole = true,
): Promise<T> {
  const url = getSupabaseUrl();
  const apiKey = useServiceRole ? getServiceKey() : getAnonKey();

  const response = await fetch(`${url}/rest/v1${endpoint}`, {
    ...options,
    headers: {
      "apikey": apiKey,
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as SupabaseError;
    const errorMessage = error.message ||
      `Supabase API error: ${response.status} ${response.statusText}`;
    const err: SupabaseError = new Error(errorMessage);
    err.code = error.code;
    err.details = error.details;
    err.hint = error.hint;
    throw err;
  }

  // Handle empty responses (like DELETE)
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * List all tables in the public schema
 */
export async function listTables(): Promise<TableInfo[]> {
  try {
    const tables = await supabaseFetch<TableInfo[]>(
      `/rpc/get_tables`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    return tables || [];
  } catch (error) {
    // Fallback: query information_schema directly
    const query =
      `?select=table_name,table_schema,table_type&table_schema=eq.public&table_type=eq.BASE TABLE`;
    const tables = await supabaseFetch<TableInfo[]>(`/information_schema.tables${query}`);
    return tables || [];
  }
}

/**
 * Get columns for a specific table
 */
export async function getTableColumns(tableName: string): Promise<ColumnInfo[]> {
  const query =
    `?select=column_name,data_type,is_nullable,column_default&table_name=eq.${tableName}&table_schema=eq.public`;
  const columns = await supabaseFetch<ColumnInfo[]>(`/information_schema.columns${query}`);
  return columns || [];
}

/**
 * Query a table with filters, sorting, and pagination
 */
export async function queryTable<T = Record<string, unknown>>(
  tableName: string,
  options: QueryOptions = {},
): Promise<T[]> {
  const params = new URLSearchParams();

  // Select columns
  if (options.select) {
    params.append("select", options.select);
  } else {
    params.append("select", "*");
  }

  // Add filters
  if (options.filter) {
    for (const [key, value] of Object.entries(options.filter)) {
      if (value === null) {
        params.append(key, "is.null");
      } else if (typeof value === "string") {
        params.append(key, `eq.${value}`);
      } else if (typeof value === "number") {
        params.append(key, `eq.${value}`);
      } else if (typeof value === "boolean") {
        params.append(key, `eq.${value}`);
      }
    }
  }

  // Add ordering
  if (options.order) {
    const direction = options.order.ascending === false ? ".desc" : ".asc";
    params.append("order", `${options.order.column}${direction}`);
  }

  // Add pagination
  if (options.limit) {
    params.append("limit", options.limit.toString());
  }
  if (options.offset) {
    params.append("offset", options.offset.toString());
  }

  const queryString = params.toString();
  const results = await supabaseFetch<T[]>(`/${tableName}?${queryString}`);
  return results || [];
}

/**
 * Insert a new row into a table
 */
export async function insertRow<T = Record<string, unknown>>(
  tableName: string,
  data: Record<string, unknown>,
): Promise<T> {
  const result = await supabaseFetch<T[]>(
    `/${tableName}`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  );

  if (!result || result.length === 0) {
    throw new Error("Insert operation did not return data");
  }

  return result[0];
}

/**
 * Update a row in a table by ID
 */
export async function updateRow<T = Record<string, unknown>>(
  tableName: string,
  id: string | number,
  data: Record<string, unknown>,
): Promise<T> {
  const result = await supabaseFetch<T[]>(
    `/${tableName}?id=eq.${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );

  if (!result || result.length === 0) {
    throw new Error(`No row found with id ${id}`);
  }

  return result[0];
}

/**
 * Update rows in a table with custom filter
 */
export async function updateRows<T = Record<string, unknown>>(
  tableName: string,
  filter: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<T[]> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filter)) {
    params.append(key, `eq.${value}`);
  }

  const result = await supabaseFetch<T[]>(
    `/${tableName}?${params.toString()}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );

  return result || [];
}

/**
 * Delete a row from a table by ID
 */
export async function deleteRow<T = Record<string, unknown>>(
  tableName: string,
  id: string | number,
): Promise<T> {
  const result = await supabaseFetch<T[]>(
    `/${tableName}?id=eq.${id}`,
    {
      method: "DELETE",
    },
  );

  if (!result || result.length === 0) {
    throw new Error(`No row found with id ${id}`);
  }

  return result[0];
}

/**
 * Delete rows from a table with custom filter
 */
export async function deleteRows<T = Record<string, unknown>>(
  tableName: string,
  filter: Record<string, unknown>,
): Promise<T[]> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filter)) {
    params.append(key, `eq.${value}`);
  }

  const result = await supabaseFetch<T[]>(
    `/${tableName}?${params.toString()}`,
    {
      method: "DELETE",
    },
  );

  return result || [];
}

/**
 * Execute a raw SQL query using RPC
 * Note: This requires a stored procedure to be created in your Supabase database
 */
export async function runRawQuery<T = unknown>(
  query: string,
): Promise<T> {
  return supabaseFetch<T>(
    "/rpc/execute_sql",
    {
      method: "POST",
      body: JSON.stringify({ query }),
    },
  );
}

/**
 * Get client instance (for use with @supabase/supabase-js if needed)
 */
export function getClient() {
  return {
    url: getSupabaseUrl(),
    anonKey: getAnonKey(),
    serviceKey: getServiceKey(),
  };
}
