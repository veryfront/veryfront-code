// In-memory API key store for development
// For production, replace with a database-backed implementation

interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey: string;
}

let configStore: SupabaseConfig | null = null;

export function setSupabaseConfig(config: SupabaseConfig): void {
  configStore = config;
}

export function getSupabaseUrl(): string {
  if (!configStore?.url) {
    throw new Error("Supabase URL not configured. Please set SUPABASE_URL environment variable.");
  }
  return configStore.url;
}

export function getAnonKey(): string {
  if (!configStore?.anonKey) {
    throw new Error(
      "Supabase anon key not configured. Please set SUPABASE_ANON_KEY environment variable.",
    );
  }
  return configStore.anonKey;
}

export function getServiceKey(): string {
  if (!configStore?.serviceKey) {
    throw new Error(
      "Supabase service key not configured. Please set SUPABASE_SERVICE_KEY environment variable.",
    );
  }
  return configStore.serviceKey;
}

export function clearConfig(): void {
  configStore = null;
}

export function isConfigured(): boolean {
  return configStore !== null;
}
