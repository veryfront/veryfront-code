import { rendererLogger as logger } from "@veryfront/utils";
import * as React from "react";
import type { ReactFeatures, ReactVersionInfo } from "./types.ts";
import { isReact17, isReact18, isReact19, parseVersion } from "./version-parser.ts";

export function detectFeatures(
  major: number,
  minor: number,
  isReact19Flag: boolean,
): ReactFeatures {
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

function buildVersionInfo(version: string): ReactVersionInfo {
  const { major, minor, patch } = parseVersion(version);
  const react19 = isReact19(major, version);
  const features = detectFeatures(major, minor, react19);

  return {
    version,
    major,
    minor,
    patch,
    isReact17: isReact17(major),
    isReact18: isReact18(major),
    isReact19: react19,
    features,
  };
}

export function detectReactVersion(): ReactVersionInfo {
  const info = buildVersionInfo(React.version);
  logger.debug("Detected React version", info);
  return info;
}

/**
 * Detect React version from a specific project directory.
 * This is used for multi-tenant rendering where each project
 * may have a different React version installed.
 */
export async function detectReactVersionFromProject(projectDir: string): Promise<ReactVersionInfo> {
  let version = React.version;

  try {
    const packageJsonPath = `${projectDir}/package.json`;
    const packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));
    const reactDep = packageJson.dependencies?.react ||
      packageJson.devDependencies?.react ||
      packageJson.peerDependencies?.react;

    if (reactDep) {
      version = reactDep.replace(/^[\^~>=<]+/, "");
      logger.debug("Detected React version from package.json", { projectDir, version });
    } else {
      logger.debug("No React in package.json, using bundled version", { projectDir, version });
    }
  } catch {
    logger.debug("Could not read package.json, using bundled React version", {
      projectDir,
      version,
    });
  }

  const info = buildVersionInfo(version);
  logger.debug("Detected React version for project", { projectDir, ...info });
  return info;
}
