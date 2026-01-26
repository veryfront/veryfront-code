import { rendererLogger as logger } from "../../../utils/index.js";
import { readTextFile } from "../../../platform/compat/fs.js";
import * as React from "react";
import { isReact17, isReact18, isReact19, parseVersion } from "./version-parser.js";
export function detectFeatures(major, minor, isReact19Flag) {
    const isReact18Plus = major >= 18;
    return {
        suspense: isReact18Plus,
        streaming: isReact18Plus,
        automaticBatching: isReact18Plus,
        transitions: isReact18Plus,
        serverComponents: isReact18Plus && minor >= 3,
        useFormStatus: isReact19Flag,
        useOptimistic: isReact19Flag,
        serverActions: isReact19Flag,
        improvedSuspense: isReact19Flag,
        enhancedStreaming: isReact19Flag,
        renderToString: true,
        renderToStaticMarkup: true,
        renderToNodeStream: true,
        renderToPipeableStream: isReact18Plus,
        renderToReadableStream: isReact18Plus,
    };
}
function buildVersionInfo(version) {
    const { major, minor, patch } = parseVersion(version);
    const react19 = isReact19(major, version);
    return {
        version,
        major,
        minor,
        patch,
        isReact17: isReact17(major),
        isReact18: isReact18(major),
        isReact19: react19,
        features: detectFeatures(major, minor, react19),
    };
}
export function detectReactVersion() {
    const info = buildVersionInfo(React.version);
    logger.debug("Detected React version", info);
    return info;
}
export async function detectReactVersionFromProject(projectDir) {
    let version = React.version;
    try {
        const packageJsonPath = `${projectDir}/package.json`;
        const packageJson = JSON.parse(await readTextFile(packageJsonPath));
        const reactDep = packageJson.dependencies?.react ??
            packageJson.devDependencies?.react ??
            packageJson.peerDependencies?.react;
        if (!reactDep) {
            logger.debug("No React in package.json, using bundled version", {
                projectDir,
                version,
            });
        }
        else {
            version = reactDep.replace(/^[\^~>=<]+/, "");
            logger.debug("Detected React version from package.json", {
                projectDir,
                version,
            });
        }
    }
    catch {
        logger.debug("Could not read package.json, using bundled React version", {
            projectDir,
            version,
        });
    }
    const info = buildVersionInfo(version);
    logger.debug("Detected React version for project", { projectDir, ...info });
    return info;
}
