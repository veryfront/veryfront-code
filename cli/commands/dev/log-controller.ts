import { deleteEnv, getEnv, setEnv } from "veryfront/platform";
import { refreshLoggerConfig } from "veryfront/utils";

export interface DevLogController {
  isVerbose(): boolean;
  toggle(): boolean;
}

function startsVerbose(): boolean {
  const level = getEnv("LOG_LEVEL")?.toUpperCase();
  if (level) return level === "DEBUG";

  const debug = getEnv("VERYFRONT_DEBUG")?.toLowerCase();
  return debug === "1" || debug === "true";
}

export function createDevLogController(): DevLogController {
  let verbose = startsVerbose();
  const initialLevel = getEnv("LOG_LEVEL");
  const normalLevel = verbose ? "INFO" : initialLevel;

  return {
    isVerbose: () => verbose,
    toggle: () => {
      verbose = !verbose;

      if (verbose) {
        setEnv("LOG_LEVEL", "DEBUG");
      } else if (normalLevel === undefined) {
        deleteEnv("LOG_LEVEL");
      } else {
        setEnv("LOG_LEVEL", normalLevel);
      }

      refreshLoggerConfig();
      return verbose;
    },
  };
}
