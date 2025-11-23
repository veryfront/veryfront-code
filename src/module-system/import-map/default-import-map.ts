import { rendererLogger as _logger } from "@veryfront/utils";
import {
  getReactImportMap,
  REACT_DEFAULT_VERSION,
  REACT_VERSION_17,
  REACT_VERSION_19,
} from "@veryfront/utils";
import type { ImportMapConfig } from "./types.ts";

export function getDefaultImportMap(): ImportMapConfig {
  const _versionMap: Record<number, string> = {
    17: REACT_VERSION_17,
    18: REACT_DEFAULT_VERSION,
    19: REACT_VERSION_19,
  };

  const reactVersion = REACT_DEFAULT_VERSION;

  const importMap = getReactImportMap(reactVersion);
  importMap["react/"] = `https://esm.sh/react@${reactVersion}/`;

  return { imports: importMap };
}
