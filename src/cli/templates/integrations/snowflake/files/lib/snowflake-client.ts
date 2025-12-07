import {
  getSnowflakeAccount,
  getSnowflakeDatabase,
  getSnowflakePassword,
  getSnowflakeSchema,
  getSnowflakeUsername,
  getSnowflakeWarehouse,
} from "./token-store.ts";

/**
 * Snowflake SQL REST API Response Types
 * Based on: https://docs.snowflake.com/en/developer-guide/sql-api/reference
 */

interface SnowflakeStatementResponse {
  statementHandle: string;
  statementStatusUrl: string;
  message?: string;
  code?: string;
}

interface SnowflakeQueryResult {
  resultSetMetaData: {
    rowType: Array<{
      name: string;
      type: string;
      nullable: boolean;
      scale?: number;
      precision?: number;
      length?: number;
    }>;
    numRows: number;
    format?: string;
    partitionInfo?: Array<{
      rowCount: number;
      uncompressedSize: number;
    }>;
  };
  data: unknown[][];
  code?: string;
  message?: string;
  statementHandle?: string;
  statementStatusUrl?: string;
}

interface SnowflakeQueryStatusResponse {
  message: string;
  code: string;
  statementHandle: string;
  statementStatusUrl: string;
  sqlText?: string;
  resultSetMetaData?: SnowflakeQueryResult["resultSetMetaData"];
  data?: unknown[][];
  stats?: {
    numRowsInserted?: number;
    numRowsUpdated?: number;
    numRowsDeleted?: number;
    numDuplicateRowsUpdated?: number;
  };
}

interface DatabaseInfo {
  name: string;
  created_on: string;
  owner: string;
  comment?: string;
}

interface SchemaInfo {
  name: string;
  database_name: string;
  created_on: string;
  owner: string;
  comment?: string;
}

interface TableInfo {
  name: string;
  database_name: string;
  schema_name: string;
  kind: string;
  created_on: string;
  row_count?: number;
  bytes?: number;
  owner: string;
  comment?: string;
}

interface ColumnInfo {
  name: string;
  type: string;
  kind: string;
  null?: string;
  default?: string;
  primary_key?: string;
  unique_key?: string;
  check?: string;
  expression?: string;
  comment?: string;
}

interface SnowflakeError extends Error {
  code?: string;
  sqlState?: string;
}

/**
 * Execute a Snowflake SQL API request
 */
async function snowflakeFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const account = getSnowflakeAccount();
  const username = getSnowflakeUsername();
  const password = getSnowflakePassword();

  // Construct the base URL for Snowflake SQL REST API
  const baseUrl = `https://${account}.snowflakecomputing.com/api/v2`;

  // Create basic auth header
  const authHeader = `Basic ${btoa(`${username}:${password}`)}`;

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as SnowflakeError;
    const errorMessage = errorData.message ||
      `Snowflake API error: ${response.status} ${response.statusText}`;
    const err: SnowflakeError = new Error(errorMessage);
    err.code = errorData.code;
    err.sqlState = errorData.sqlState;
    throw err;
  }

  return await response.json();
}

/**
 * Submit a SQL statement for execution
 */
async function submitStatement(
  sqlText: string,
  database?: string,
  schema?: string,
  timeout?: number,
  async_exec = false,
): Promise<SnowflakeStatementResponse | SnowflakeQueryResult> {
  const warehouse = getSnowflakeWarehouse();
  const defaultDatabase = database || getSnowflakeDatabase();
  const defaultSchema = schema || getSnowflakeSchema();

  const requestBody = {
    statement: sqlText,
    warehouse,
    database: defaultDatabase,
    schema: defaultSchema,
    timeout: timeout || 60,
    resultSetMetaData: {
      format: "json",
    },
    parameters: {},
  };

  // For async execution, use the /statements endpoint
  // For sync execution, use /statements with async=false
  const endpoint = async_exec
    ? "/statements?async=true"
    : "/statements";

  return await snowflakeFetch<SnowflakeStatementResponse | SnowflakeQueryResult>(
    endpoint,
    {
      method: "POST",
      body: JSON.stringify(requestBody),
    },
  );
}

/**
 * Get the status and results of a statement
 */
export async function getQueryStatus(
  statementHandle: string,
): Promise<SnowflakeQueryStatusResponse> {
  return await snowflakeFetch<SnowflakeQueryStatusResponse>(
    `/statements/${statementHandle}`,
  );
}

/**
 * Cancel a running statement
 */
export async function cancelQuery(statementHandle: string): Promise<void> {
  await snowflakeFetch(`/statements/${statementHandle}/cancel`, {
    method: "POST",
  });
}

/**
 * Transform Snowflake result format to more usable JSON objects
 */
function transformResults(result: SnowflakeQueryResult): Record<string, unknown>[] {
  if (!result.data || result.data.length === 0) {
    return [];
  }

  const columns = result.resultSetMetaData.rowType.map((col) => col.name);

  return result.data.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, index) => {
      obj[col] = row[index];
    });
    return obj;
  });
}

/**
 * Run a SQL query and return results
 */
export async function runQuery(
  sql: string,
  database?: string,
  schema?: string,
  options: {
    timeout?: number;
    async?: boolean;
  } = {},
): Promise<{
  columns: Array<{ name: string; type: string; nullable: boolean }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  statementHandle?: string;
}> {
  const result = await submitStatement(
    sql,
    database,
    schema,
    options.timeout,
    options.async,
  );

  // Handle async execution
  if ("statementHandle" in result && !("data" in result)) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      statementHandle: result.statementHandle,
    };
  }

  // Handle synchronous result
  const queryResult = result as SnowflakeQueryResult;

  const columns = queryResult.resultSetMetaData.rowType.map((col) => ({
    name: col.name,
    type: col.type,
    nullable: col.nullable,
  }));

  const rows = transformResults(queryResult);

  return {
    columns,
    rows,
    rowCount: queryResult.resultSetMetaData.numRows,
    statementHandle: queryResult.statementHandle,
  };
}

/**
 * List all databases in the account
 */
export async function listDatabases(): Promise<DatabaseInfo[]> {
  const result = await runQuery("SHOW DATABASES");
  return result.rows as DatabaseInfo[];
}

/**
 * List all schemas in a database
 */
export async function listSchemas(database: string): Promise<SchemaInfo[]> {
  const result = await runQuery(`SHOW SCHEMAS IN DATABASE ${database}`);
  return result.rows as SchemaInfo[];
}

/**
 * List all tables in a database schema
 */
export async function listTables(
  database: string,
  schema: string,
): Promise<TableInfo[]> {
  const result = await runQuery(
    `SHOW TABLES IN ${database}.${schema}`,
  );
  return result.rows as TableInfo[];
}

/**
 * Get detailed information about a table's columns
 */
export async function describeTable(
  database: string,
  schema: string,
  table: string,
): Promise<{
  columns: ColumnInfo[];
  primaryKeys: string[];
}> {
  const result = await runQuery(
    `DESCRIBE TABLE ${database}.${schema}.${table}`,
  );

  const columns = result.rows as ColumnInfo[];
  const primaryKeys = columns
    .filter((col) => col.primary_key === "Y")
    .map((col) => col.name);

  return {
    columns,
    primaryKeys,
  };
}

/**
 * Get table row count
 */
export async function getTableRowCount(
  database: string,
  schema: string,
  table: string,
): Promise<number> {
  const result = await runQuery(
    `SELECT COUNT(*) as count FROM ${database}.${schema}.${table}`,
  );

  if (result.rows.length > 0 && "count" in result.rows[0]) {
    return Number(result.rows[0].count);
  }

  return 0;
}

/**
 * Get current Snowflake version and session info
 */
export async function getSessionInfo(): Promise<{
  version: string;
  warehouse: string;
  database?: string;
  schema?: string;
  user: string;
  role?: string;
}> {
  const result = await runQuery(`
    SELECT
      CURRENT_VERSION() as version,
      CURRENT_WAREHOUSE() as warehouse,
      CURRENT_DATABASE() as database,
      CURRENT_SCHEMA() as schema,
      CURRENT_USER() as user,
      CURRENT_ROLE() as role
  `);

  if (result.rows.length === 0) {
    throw new Error("Failed to get session info");
  }

  return result.rows[0] as {
    version: string;
    warehouse: string;
    database?: string;
    schema?: string;
    user: string;
    role?: string;
  };
}
