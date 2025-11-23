import { rendererLogger as logger } from "@veryfront/utils";
import * as React from "react";
import type { ReactFeatures, ReactVersionInfo } from "./types.ts";
import { isReact17, isReact18, isReact19, parseVersion } from "./version-parser.ts";

export function detectFeatures(
  major: number,
  minor: number,
  isReact19Flag: boolean,
): ReactFeatures {
  return {
    suspense: major >= 18,
    streaming: major >= 18,
    automaticBatching: major >= 18,
    transitions: major >= 18,
    serverComponents: major >= 18 && minor >= 3,

    useFormStatus: isReact19Flag,
    useOptimistic: isReact19Flag,
    serverActions: isReact19Flag,
    improvedSuspense: isReact19Flag,
    enhancedStreaming: isReact19Flag,

    renderToString: true, // Available in all versions
    renderToStaticMarkup: true, // Available in all versions
    renderToNodeStream: true, // Available in all versions (deprecated in 18+)
    renderToPipeableStream: major >= 18,
    renderToReadableStream: major >= 18,
  };
}

export function detectReactVersion(): ReactVersionInfo {
  const version = React.version;
  const { major, minor, patch } = parseVersion(version);

  const react17 = isReact17(major);
  const react18 = isReact18(major);
  const react19 = isReact19(major, version);

  const features = detectFeatures(major, minor, react19);

  const info: ReactVersionInfo = {
    version,
    major,
    minor,
    patch,
    isReact17: react17,
    isReact18: react18,
    isReact19: react19,
    features,
  };

  logger.info("Detected React version", info);

  return info;
}
