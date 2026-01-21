import { join } from "#veryfront/platform/compat/path-helper.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
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
 * 2. Default discovery: components/app.{tsx,jsx,ts,js,mdx,md}
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

  // app: false explicitly disables app component
  if (configApp === false) {
    logger.debug("[AppResolver] App component disabled via config.app: false");
    return null;
  }

  if (configApp && isValidComponentPath(configApp)) {
    const appPath = configApp.startsWith("/") || configApp.startsWith(projectDir)
      ? configApp
      : join(projectDir, configApp);

    if (await adapter.fs.exists(appPath)) {
      logger.debug("[AppResolver] Using config.app", { path: appPath });
      return appPath;
    }
    // config.app is explicitly set but file doesn't exist - this is an error
    throw new Error(
      `App component not found: "${configApp}" (resolved to "${appPath}"). ` +
        `Check your veryfront.config.ts 'app' setting.`,
    );
  }

  // Priority 2: Default discovery - check components/app.{ext}
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
