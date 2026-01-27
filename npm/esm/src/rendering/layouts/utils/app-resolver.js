import { join } from "../../../platform/compat/path-helper.js";
import { rendererLogger as logger } from "../../../utils/index.js";
const VALID_EXTENSIONS = ["tsx", "jsx", "ts", "js", "mdx", "md"];
function isValidComponentPath(path) {
    const ext = path.slice(path.lastIndexOf(".") + 1);
    return VALID_EXTENSIONS.includes(ext);
}
export async function resolveAppComponentPath(projectDir, adapter, config) {
    console.log("[AppResolver] Starting resolution", {
        projectDir,
        hasAdapter: !!adapter,
        hasConfig: !!config,
        configApp: config?.app,
    });
    logger.debug("[AppResolver] Starting resolution", {
        projectDir,
        hasAdapter: !!adapter,
        hasConfig: !!config,
        configApp: config?.app,
    });
    const configApp = config?.app;
    if (configApp === false) {
        logger.debug("[AppResolver] App component disabled via config.app: false");
        return null;
    }
    if (configApp) {
        if (!isValidComponentPath(configApp)) {
            throw new Error(`App component not found: "${configApp}". ` +
                `Check your veryfront.config.ts 'app' setting.`);
        }
        const appPath = configApp.startsWith("/") || configApp.startsWith(projectDir)
            ? configApp
            : join(projectDir, configApp);
        if (await adapter.fs.exists(appPath)) {
            logger.debug("[AppResolver] Using config.app", { path: appPath });
            return appPath;
        }
        throw new Error(`App component not found: "${configApp}" (resolved to "${appPath}"). ` +
            `Check your veryfront.config.ts 'app' setting.`);
    }
    for (const ext of VALID_EXTENSIONS) {
        const appPath = join(projectDir, `components/app.${ext}`);
        const exists = await adapter.fs.exists(appPath);
        console.log("[AppResolver] Checking default path", { appPath, exists });
        logger.debug("[AppResolver] Checking default path", { appPath, exists });
        if (exists) {
            console.log("[AppResolver] Found app component via discovery", { path: appPath });
            logger.debug("[AppResolver] Found app component via discovery", { path: appPath });
            return appPath;
        }
    }
    console.log("[AppResolver] No app component found");
    logger.debug("[AppResolver] No app component found");
    return null;
}
