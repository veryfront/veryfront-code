import { isTruthyEnvValue } from "#veryfront/utils/constants/env.ts";
import { deleteEnv, getEnv, setEnv } from "veryfront/platform";
import { refreshLoggerConfig } from "veryfront/utils";

export interface DevLogController {
  isVerbose(): boolean;
  toggle(): boolean;
}

function startsVerbose(): boolean {
  const level = getEnv("LOG_LEVEL")?.toUpperCase();
  return level === "DEBUG" || isTruthyEnvValue(getEnv("VERYFRONT_DEBUG"));
}

export function createDevLogController(): DevLogController {
  let verbose = startsVerbose();
  const initialLevel = getEnv("LOG_LEVEL");
  const normalLevel = initialLevel?.toUpperCase() === "DEBUG" ? "INFO" : initialLevel;

  return {
    isVerbose: () => verbose,
    toggle: () => {
      verbose = !verbose;

      if (verbose) {
        setEnv("LOG_LEVEL", "DEBUG");
        setEnv("VERYFRONT_DEBUG", "1");
      } else if (normalLevel === undefined) {
        deleteEnv("LOG_LEVEL");
      } else {
        setEnv("LOG_LEVEL", normalLevel);
      }

      if (!verbose) deleteEnv("VERYFRONT_DEBUG");

      refreshLoggerConfig();
      return verbose;
    },
  };
}
