import { join } from "#veryfront/compat/path";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { rendererLogger as logger } from "#veryfront/utils";

const log = logger.component("app-resolver");

const VALID_EXTENSIONS = ["tsx", "jsx", "ts", "js", "mdx", "md"];

function isValidComponentPath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".") + 1);
  return VALID_EXTENSIONS.includes(ext);
}

export async function resolveAppComponentPath(
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
): Promise<string | null> {
  log.debug("Starting resolution", {
    projectDir,
    hasAdapter: !!adapter,
    hasConfig: !!config,
    configApp: config?.app,
  });

  const configApp = config?.app;

  if (configApp === false) {
    log.debug("App component disabled via config.app: false");
    return null;
  }

  if (configApp) {
    if (!isValidComponentPath(configApp)) {
      throw new Error(
        `App component not found: "${configApp}". Check your veryfront.config.ts 'app' setting.`,
      );
    }

    const appPath = configApp.startsWith("/") || configApp.startsWith(projectDir)
      ? configApp
      : join(projectDir, configApp);

    if (!(await adapter.fs.exists(appPath))) {
      throw new Error(
        `App component not found: "${configApp}" (resolved to "${appPath}"). Check your veryfront.config.ts 'app' setting.`,
      );
    }

    log.debug("Using config.app", { path: appPath });
    return appPath;
  }

  for (const ext of VALID_EXTENSIONS) {
    const appPath = join(projectDir, `components/app.${ext}`);
    const exists = await adapter.fs.exists(appPath);
    log.debug("Checking default path", { appPath, exists });

    if (!exists) continue;

    log.debug("Found app component via discovery", { path: appPath });
    return appPath;
  }

  log.debug("No app component found");
  return null;
}
