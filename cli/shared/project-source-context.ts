import { getConfig, type VeryfrontConfig } from "veryfront/config";
import {
  enhanceAdapterWithFS,
  getEnv,
  isExtendedFSAdapter,
  type RuntimeAdapter,
} from "veryfront/platform";
import { captureHostApiEnvironment, getHostEnv } from "#cli/process-env";
import { runtime } from "#cli/runtime-adapter";
import { applyRuntimeAuthContext, resolveLinkedProjectSlug } from "./runtime-auth.ts";

interface ProxyProjectSourceContext {
  projectSlug: string;
  token: string;
  projectId?: string;
  branchRef?: string | null;
}

export interface ProjectSourceExecutionContext {
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  projectDir: string;
  configCacheKey?: string;
  projectId?: string;
  proxyContext?: ProxyProjectSourceContext;
}

// Captured before project code runs: the host-private stored login token is
// normalized here, so a project that replaces `String.prototype.trim` — or
// `Reflect.apply` itself, which would otherwise receive the credential as its
// `thisArgument` — must not observe it. `withProjectSourceContext` executes
// project config before `getProxyProjectSourceContext` runs, so both
// intrinsics must be captured at module initialization.
const applyIntrinsic = Reflect.apply;
const stringTrim = String.prototype.trim;

function trimHostPrivate(value: string | undefined): string | undefined {
  return value === undefined ? undefined : applyIntrinsic(stringTrim, value, []) as string;
}

export function getProxyProjectSourceContext(): ProxyProjectSourceContext | null {
  const projectSlug = getEnv("VERYFRONT_PROJECT_SLUG")?.trim();
  // Host-scoped: `applyRuntimeAuthContext` keeps the CLI login token out of the
  // process environment, so it resolves through `getHostEnv` and not `getEnv`.
  const token = trimHostPrivate(getHostEnv("VERYFRONT_API_TOKEN"));

  if (!projectSlug || !token) {
    return null;
  }

  const projectId = getEnv("VERYFRONT_PROJECT_ID")?.trim();
  const branchRef = getEnv("VERYFRONT_BRANCH_REF")?.trim() ||
    getEnv("TENANT_BRANCH_ID")?.trim();

  return {
    projectSlug,
    token,
    projectId: projectId || undefined,
    branchRef: branchRef || null,
  };
}

async function loadProjectConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
  proxyContext?: ProxyProjectSourceContext,
): Promise<VeryfrontConfig> {
  const cacheKey = getProjectSourceConfigCacheKey(proxyContext);
  return await getConfig(projectDir, adapter, cacheKey ? { cacheKey } : undefined);
}

function getProjectSourceConfigCacheKey(
  proxyContext?: ProxyProjectSourceContext,
): string | undefined {
  return proxyContext?.projectId ?? proxyContext?.projectSlug;
}

export async function applyProjectSourceRuntimeAuth(
  projectDir: string,
  config: VeryfrontConfig,
) {
  return await applyRuntimeAuthContext({
    linkedProjectSlug: await resolveLinkedProjectSlug(
      projectDir,
      config.projectSlug ?? config.fs?.veryfront?.projectSlug,
    ),
  });
}

export async function withProjectSourceContext<T>(
  projectDir: string,
  run: (context: ProjectSourceExecutionContext) => Promise<T>,
): Promise<T> {
  captureHostApiEnvironment();
  const baseAdapter = await runtime.get();
  const initialConfig = await getConfig(projectDir, baseAdapter);
  await applyProjectSourceRuntimeAuth(projectDir, initialConfig);
  const adapter = await enhanceAdapterWithFS(baseAdapter, initialConfig as any, projectDir);
  const proxyContext = getProxyProjectSourceContext();

  if (
    proxyContext &&
    isExtendedFSAdapter(adapter.fs) &&
    adapter.fs.isMultiProjectMode()
  ) {
    return await adapter.fs.runWithContext(
      proxyContext.projectSlug,
      proxyContext.token,
      async () => {
        const config = await loadProjectConfig(projectDir, adapter, proxyContext);
        return await run({
          adapter,
          config,
          projectDir,
          configCacheKey: getProjectSourceConfigCacheKey(proxyContext),
          projectId: proxyContext.projectId,
          proxyContext,
        });
      },
      proxyContext.projectId,
      {
        productionMode: false,
        branch: proxyContext.branchRef ?? null,
      },
    );
  }

  const config = await loadProjectConfig(projectDir, adapter);
  return await run({
    adapter,
    config,
    projectDir,
    configCacheKey: getProjectSourceConfigCacheKey(proxyContext ?? undefined),
    projectId: proxyContext?.projectId,
    proxyContext: proxyContext ?? undefined,
  });
}
