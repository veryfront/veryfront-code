import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

export interface ActionBody {
  id: string;
  args: unknown[];
}

export interface ActionRequestParams {
  req: Request;
  projectDir: string;
  projectId?: string;
  contentSourceId?: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
  mode?: "development" | "production";
}

export interface RSCEndpointParams {
  req: Request;
  pathname: string;
  projectDir: string;
  projectId?: string;
  projectSlug?: string;
  contentSourceId?: string;
  releaseId?: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
  isLocalProject?: boolean;
  mode?: "development" | "production";
  nonce?: string;
}
