import { rendererLogger as logger } from "../../utils/index.js";
import { join } from "../../platform/compat/path/index.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { getReactUrls } from "../../transforms/esm/package-registry.js";
import { REACT_VERSION_17, REACT_VERSION_18_2, REACT_VERSION_19_RC, } from "../../utils/constants/cdn.js";
export const REACT_CONFIGS = {
    "17": {
        version: "17",
        exact: REACT_VERSION_17,
        imports: getReactUrls(REACT_VERSION_17),
    },
    "18": {
        version: "18",
        exact: REACT_VERSION_18_2,
        imports: getReactUrls(REACT_VERSION_18_2),
    },
    "19": {
        version: "19",
        exact: REACT_VERSION_19_RC,
        imports: getReactUrls(REACT_VERSION_19_RC),
    },
};
function getReactConfig(version) {
    const config = REACT_CONFIGS[version];
    if (config)
        return config;
    throw toError(createError({
        type: "config",
        message: `Unsupported React version: ${version}`,
    }));
}
export async function generateReactVersionConfig(projectDir, targetVersion, options = {}) {
    const config = getReactConfig(targetVersion);
    const fs = createFileSystem();
    const baseConfigPath = join(projectDir, options.extends ?? "deno.json");
    let baseConfig = {};
    try {
        baseConfig = JSON.parse(await fs.readTextFile(baseConfigPath));
    }
    catch (error) {
        logger.warn(`Could not read base config from ${baseConfigPath}`, error);
    }
    const versionConfig = {
        ...baseConfig,
        imports: {
            ...(baseConfig.imports ?? {}),
            ...config.imports,
            ...(options.additional?.imports ?? {}),
        },
    };
    const configPath = join(projectDir, `deno.react${targetVersion}.json`);
    await fs.writeTextFile(configPath, JSON.stringify(versionConfig, null, 2));
    logger.info(`Generated React ${targetVersion} configuration at ${configPath}`);
}
export async function generateAllReactConfigs(projectDir) {
    await Promise.all(Object.keys(REACT_CONFIGS).map((version) => generateReactVersionConfig(projectDir, version)));
}
export function getReactImports(version) {
    return getReactConfig(version).imports;
}
export async function detectReactVersionFromConfig(projectDir) {
    try {
        const fs = createFileSystem();
        const configPath = join(projectDir, "deno.json");
        const config = JSON.parse(await fs.readTextFile(configPath));
        const reactImport = config.imports?.react;
        if (!reactImport)
            return null;
        for (const [version, versionConfig] of Object.entries(REACT_CONFIGS)) {
            if (reactImport.includes(`@${versionConfig.exact}`))
                return version;
        }
        if (reactImport.includes("@17"))
            return "17";
        if (reactImport.includes("@18"))
            return "18";
        if (reactImport.includes("@19"))
            return "19";
        return null;
    }
    catch (error) {
        logger.error("Failed to detect React version from config", error);
        return null;
    }
}
export function createReactVersionSwitcher(projectDir) {
    return {
        async switchTo(version) {
            const fs = createFileSystem();
            const configPath = join(projectDir, `deno.react${version}.json`);
            if (!(await fs.exists(configPath))) {
                await generateReactVersionConfig(projectDir, version);
            }
            logger.info(`Switched to React ${version} configuration`);
            logger.info(`Use --config deno.react${version}.json to run with React ${version}`);
        },
        getCurrentVersion() {
            return detectReactVersionFromConfig(projectDir);
        },
        getAvailableVersions() {
            return Object.keys(REACT_CONFIGS);
        },
    };
}
