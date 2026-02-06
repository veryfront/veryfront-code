import { getApiKey, getDatabaseUrl } from "./token-store.ts";
import { Client } from "pg";

const NEON_API_BASE_URL = "https://console.neon.tech/api/v2";

interface NeonProject {
  id: string;
  platform_id: string;
  region_id: string;
  name: string;
  provisioner: string;
  default_endpoint_settings?: {
    autoscaling_limit_min_cu: number;
    autoscaling_limit_max_cu: number;
    suspend_timeout_seconds: number;
  };
  settings?: {
    quota?: {
      active_time_seconds?: number;
      compute_time_seconds?: number;
      written_data_bytes?: number;
      data_transfer_bytes?: number;
    };
  };
  pg_version: number;
  store_passwords: boolean;
  creation_source: string;
  created_at: string;
  updated_at: string;
  proxy_host: string;
  branch_logical_size_limit: number;
  branch_logical_size_limit_bytes: number;
  cpu_used_sec: number;
  maintenance_starts_at?: string;
}

interface NeonBranch {
  id: string;
  project_id: string;
  parent_id?: string;
  parent_lsn?: string;
  parent_timestamp?: string;
  name: string;
  current_state: string;
  pending_state?: string;
  logical_size?: number;
  creation_source: string;
  primary?: boolean;
  default?: boolean;
  protected?: boolean;
  cpu_used_sec: number;
  compute_time_sec?: number;
  active_time_sec?: number;
  written_data_bytes?: number;
  data_transfer_bytes?: number;
  created_at: string;
  updated_at: string;
}

interface NeonProjectsResponse {
  projects: NeonProject[];
}

interface NeonBranchesResponse {
  branches: NeonBranch[];
}

interface NeonEndpoint {
  host: string;
  id: string;
  project_id: string;
  branch_id: string;
  autoscaling_limit_min_cu: number;
  autoscaling_limit_max_cu: number;
  region_id: string;
  type: string;
  current_state: string;
  settings: {
    pg_settings?: Record<string, string>;
  };
  pooler_enabled: boolean;
  pooler_mode?: string;
  disabled: boolean;
  passwordless_access: boolean;
  creation_source: string;
  created_at: string;
  updated_at: string;
  proxy_host: string;
  suspend_timeout_seconds: number;
  provisioner: string;
}

interface NeonEndpointsResponse {
  endpoints: NeonEndpoint[];
}

interface TableInfo {
  tablename: string;
  schemaname: string;
  tableowner: string;
}

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
}

async function neonFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const apiKey = getApiKey() ?? process.env.NEON_API_KEY;
  if (!apiKey) {
    throw new Error("Not authenticated with Neon. Please set NEON_API_KEY.");
  }

  const response = await fetch(`${NEON_API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      `Neon API error: ${response.status} ${error.message ?? response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

export async function listProjects(): Promise<NeonProject[]> {
  const { projects } = await neonFetch<NeonProjectsResponse>("/projects");
  return projects;
}

export function getProject(projectId: string): Promise<NeonProject> {
  return neonFetch<NeonProject>(`/projects/${projectId}`);
}

export async function listBranches(projectId: string): Promise<NeonBranch[]> {
  const { branches } = await neonFetch<NeonBranchesResponse>(
    `/projects/${projectId}/branches`,
  );
  return branches;
}

export async function createBranch(
  projectId: string,
  options: {
    name?: string;
    parentId?: string;
    parentLsn?: string;
    parentTimestamp?: string;
  },
): Promise<NeonBranch> {
  const branch: Record<string, unknown> = {
    name: options.name,
    ...(options.parentId ? { parent_id: options.parentId } : {}),
    ...(options.parentLsn ? { parent_lsn: options.parentLsn } : {}),
    ...(options.parentTimestamp ? { parent_timestamp: options.parentTimestamp } : {}),
  };

  const { branch: createdBranch } = await neonFetch<{ branch: NeonBranch }>(
    `/projects/${projectId}/branches`,
    {
      method: "POST",
      body: JSON.stringify({ branch }),
    },
  );

  return createdBranch;
}

export async function listEndpoints(projectId: string): Promise<NeonEndpoint[]> {
  const { endpoints } = await neonFetch<NeonEndpointsResponse>(
    `/projects/${projectId}/endpoints`,
  );
  return endpoints;
}

async function getDbClient(): Promise<Client> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL not configured. Please set DATABASE_URL environment variable.",
    );
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  return client;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number }> {
  const client = await getDbClient();

  try {
    const result = await client.query(sql, params);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  } finally {
    await client.end();
  }
}

export async function listTables(schema: string = "public"): Promise<TableInfo[]> {
  const result = await query<TableInfo>(
    `SELECT tablename, schemaname, tableowner
     FROM pg_tables
     WHERE schemaname = $1
     ORDER BY tablename`,
    [schema],
  );

  return result.rows;
}

export async function describeTable(
  tableName: string,
  schema: string = "public",
): Promise<{ tableName: string; schema: string; columns: ColumnInfo[] }> {
  const result = await query<ColumnInfo>(
    `SELECT
      column_name,
      data_type,
      is_nullable,
      column_default,
      character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position`,
    [schema, tableName],
  );

  return { tableName, schema, columns: result.rows };
}

export async function getTableRowCount(
  tableName: string,
  schema: string = "public",
): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM "${schema}"."${tableName}"`,
  );

  return parseInt(result.rows[0]?.count ?? "0", 10);
}
