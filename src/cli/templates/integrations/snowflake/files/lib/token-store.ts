// In-memory configuration store for development
// For production, replace with a secure database-backed implementation

interface SnowflakeConfig {
  account: string;
  username: string;
  password: string;
  warehouse: string;
  database?: string;
  schema?: string;
}

let configStore: SnowflakeConfig | null = null;

export function setSnowflakeConfig(config: SnowflakeConfig): void {
  configStore = config;
}

export function getSnowflakeAccount(): string {
  if (!configStore?.account) {
    throw new Error(
      "Snowflake account not configured. Please set SNOWFLAKE_ACCOUNT environment variable.",
    );
  }
  return configStore.account;
}

export function getSnowflakeUsername(): string {
  if (!configStore?.username) {
    throw new Error(
      "Snowflake username not configured. Please set SNOWFLAKE_USERNAME environment variable.",
    );
  }
  return configStore.username;
}

export function getSnowflakePassword(): string {
  if (!configStore?.password) {
    throw new Error(
      "Snowflake password not configured. Please set SNOWFLAKE_PASSWORD environment variable.",
    );
  }
  return configStore.password;
}

export function getSnowflakeWarehouse(): string {
  if (!configStore?.warehouse) {
    throw new Error(
      "Snowflake warehouse not configured. Please set SNOWFLAKE_WAREHOUSE environment variable.",
    );
  }
  return configStore.warehouse;
}

export function getSnowflakeDatabase(): string | undefined {
  return configStore?.database;
}

export function getSnowflakeSchema(): string {
  return configStore?.schema || "PUBLIC";
}

export function clearConfig(): void {
  configStore = null;
}

export function isConfigured(): boolean {
  return configStore !== null &&
    !!configStore.account &&
    !!configStore.username &&
    !!configStore.password &&
    !!configStore.warehouse;
}

export function getConfig(): SnowflakeConfig | null {
  return configStore;
}
