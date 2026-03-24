import { getConfig, type VeryfrontConfig } from "veryfront/config";
import {
  enhanceAdapterWithFS,
  getEnv,
  isExtendedFSAdapter,
  runtime,
  type RuntimeAdapter,
} from "veryfront/platform";

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
  projectId?: string;
  proxyContext?: ProxyProjectSourceContext;
}

function getProxyProjectSourceContext(): ProxyProjectSourceContext | null {
  const projectSlug = getEnv("VERYFRONT_PROJECT_SLUG")?.trim();
  const token = getEnv("VERYFRONT_API_TOKEN")?.trim();

  if (!projectSlug || !token) {
    return null;
  }

  const projectId = getEnv("VERYFRONT_PROJECT_ID")?.trim();
  const branchRef = getEnv("VERYFRONT_BRANCH_REF")?.trim();

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
  const cacheKey = proxyContext?.projectId ?? proxyContext?.projectSlug;
  return await getConfig(projectDir, adapter, cacheKey ? { cacheKey } : undefined);
}

export async function withProjectSourceContext<T>(
  projectDir: string,
  run: (context: ProjectSourceExecutionContext) => Promise<T>,
): Promise<T> {
  const baseAdapter = await runtime.get();
  const initialConfig = await getConfig(projectDir, baseAdapter);
  const adapter = await enhanceAdapterWithFS(baseAdapter, initialConfig, projectDir);
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
    projectId: proxyContext?.projectId,
    proxyContext: proxyContext ?? undefined,
  });
}
