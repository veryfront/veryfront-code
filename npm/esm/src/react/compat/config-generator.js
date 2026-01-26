import { rendererLogger as logger } from "../../utils/index.js";
import { join } from "../../platform/compat/path/index.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { createFileSystem } from "../../platform/compat/fs.js";
export const REACT_CONFIGS = {
    "17": {
        version: "17",
        exact: "17.0.2",
        imports: {
            react: "https://esm.sh/react@17.0.2",
            "react-dom": "https://esm.sh/react-dom@17.0.2",
            "react-dom/server": "https://esm.sh/react-dom@17.0.2/server",
            "react/jsx-runtime": "https://esm.sh/react@17.0.2/jsx-runtime",
            "react/jsx-dev-runtime": "https://esm.sh/react@17.0.2/jsx-dev-runtime",
        },
    },
    "18": {
        version: "18",
        exact: "18.2.0",
        imports: {
            react: "https://esm.sh/react@18.2.0",
            "react-dom": "https://esm.sh/react-dom@18.2.0",
            "react-dom/server": "https://esm.sh/react-dom@18.2.0/server",
            "react-dom/client": "https://esm.sh/react-dom@18.2.0/client",
            "react/jsx-runtime": "https://esm.sh/react@18.2.0/jsx-runtime",
            "react/jsx-dev-runtime": "https://esm.sh/react@18.2.0/jsx-dev-runtime",
        },
    },
    "19": {
        version: "19",
        exact: "19.0.0-rc.0",
        imports: {
            react: "https://esm.sh/react@19.0.0-rc.0",
            "react-dom": "https://esm.sh/react-dom@19.0.0-rc.0",
            "react-dom/server": "https://esm.sh/react-dom@19.0.0-rc.0/server",
            "react-dom/client": "https://esm.sh/react-dom@19.0.0-rc.0/client",
            "react/jsx-runtime": "https://esm.sh/react@19.0.0-rc.0/jsx-runtime",
            "react/jsx-dev-runtime": "https://esm.sh/react@19.0.0-rc.0/jsx-dev-runtime",
        },
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
