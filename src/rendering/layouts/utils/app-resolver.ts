import { join } from "#veryfront/platform/compat/path-helper.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { rendererLogger as logger } from "#veryfront/utils";

const VALID_EXTENSIONS = ["tsx", "jsx", "ts", "js", "mdx", "md"];

function isValidComponentPath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".") + 1);
  return VALID_EXTENSIONS.includes(ext);
}

/**
 * Resolve App component path with unified logic.
 * Used by both SSR (LayoutApplicator) and hydration (HTMLGenerator).
 *
 * Priority:
 * 1. config.app from veryfront.config.ts
 * 2. API project data (for Veryfront Studio)
 * 3. Default discovery: components/app.{tsx,jsx,ts,js,mdx,md}
 */
export async function resolveAppComponentPath(
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
): Promise<string | null> {
  logger.debug("[AppResolver] Starting resolution", {
    projectDir,
    hasAdapter: !!adapter,
    hasConfig: !!config,
    configApp: config?.app,
  });

  // Priority 1: Check config.app from veryfront.config.ts
  const configApp = config?.app;
  if (configApp && isValidComponentPath(configApp)) {
    const appPath = configApp.startsWith("/") || configApp.startsWith(projectDir)
      ? configApp
      : join(projectDir, configApp);

    if (await adapter.fs.exists(appPath)) {
      logger.debug("[AppResolver] Using config.app", { path: appPath });
      return appPath;
    }
    logger.debug("[AppResolver] config.app path not found", { configApp, appPath });
  }

  // Priority 2: Check API project data (for Veryfront Studio)
  const fs = adapter?.fs;
  const isExtended = fs && isExtendedFSAdapter(fs);
  const isVeryfront = isExtended && fs.isVeryfrontAdapter();
  logger.debug("[AppResolver] Checking API project data", { isExtended, isVeryfront });

  if (isVeryfront) {
    const wrappedAdapter = fs.getUnderlyingAdapter() as {
      getProjectData?: () => { app?: string } | undefined;
      exists: (path: string) => Promise<boolean>;
    };
    const projectData = wrappedAdapter.getProjectData?.();
    logger.debug("[AppResolver] Project data", { projectData });

    if (projectData?.app && isValidComponentPath(projectData.app)) {
      const appPath = join(projectDir, "components", projectData.app);
      const exists = await wrappedAdapter.exists(appPath);
      logger.debug("[AppResolver] API app path check", { appPath, exists });

      if (exists) {
        logger.debug("[AppResolver] Using API project app", { path: appPath });
        return appPath;
      }
    }
  }

  // Priority 3: Default discovery - check components/app.{ext}
  for (const ext of VALID_EXTENSIONS) {
    const appPath = join(projectDir, `components/app.${ext}`);
    const exists = await adapter.fs.exists(appPath);
    logger.debug("[AppResolver] Checking default path", { appPath, exists });
    if (exists) {
      logger.debug("[AppResolver] Found app component via discovery", { path: appPath });
      return appPath;
    }
  }

  logger.debug("[AppResolver] No app component found");
  return null;
}
