import { getReactImportMap, REACT_DEFAULT_VERSION } from "@veryfront/utils";
import type { ImportMapConfig } from "./types.ts";

export function getDefaultImportMap(): ImportMapConfig {
  const reactVersion = REACT_DEFAULT_VERSION;

  const importMap = getReactImportMap(reactVersion);
  importMap["react/"] = `https://esm.sh/react@${reactVersion}/`;

  return { imports: importMap };
}
