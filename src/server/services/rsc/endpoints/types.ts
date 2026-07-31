import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { ClientModuleStrategy } from "#veryfront/types/rsc.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";

export interface ActionBody {
  id: string;
  args: unknown[];
}

export interface ActionRequestParams {
  req: Request;
  projectDir: string;
  projectId?: string;
  projectSlug?: string;
  contentSourceId?: string;
  releaseId?: string;
  branch?: string | null;
  isLocalProject?: boolean;
  dependencyPinningSource?: DependencyPinningSourceInput;
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
  branch?: string | null;
  dependencyPinningSource?: DependencyPinningSourceInput;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
  isLocalProject?: boolean;
  clientModuleStrategy?: ClientModuleStrategy;
  mode?: "development" | "production";
  nonce?: string;
}
