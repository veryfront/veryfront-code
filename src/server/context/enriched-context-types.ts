import type { VeryfrontConfig } from "#veryfront/config/schemas/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ParsedDomain } from "#veryfront/server/utils/domain-parser.ts";

export type Environment = "preview" | "production";
export type RenderMode = "development" | "production";

export interface ProjectData {
  id: string;
  slug: string;
  name?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface EnrichedContext {
  projectId: string;
  projectSlug: string;
  projectDir: string;

  token: string;
  environment: Environment;
  branch: string | null;
  isLocalProject: boolean;
  mode: RenderMode;

  /** Content source identifier for cache isolation (e.g., "release-abc123", "preview-main", "local-main") */
  contentSourceId: string;
  releaseId?: string;
  environmentName?: string;
  parsedDomain: ParsedDomain;
  projectData?: ProjectData;

  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  cachePrefix: string;

  moduleServerUrl?: string;
  nonce?: string;
  debug?: boolean;

  createdAt: number;
}

export interface BuildEnrichedContextOptions {
  projectId: string;
  projectSlug: string;
  projectDir: string;
  token: string;
  environment: Environment;
  branch: string | null;
  isLocalProject: boolean;
  /** Content source identifier for cache isolation - computed by proxy */
  contentSourceId: string;
  parsedDomain: ParsedDomain;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;

  releaseId?: string;
  environmentName?: string;
  projectData?: ProjectData;
  moduleServerUrl?: string;
  nonce?: string;
  debug?: boolean;
}
