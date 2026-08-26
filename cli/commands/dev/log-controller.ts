import { deleteEnv, getEnv, setEnv } from "../../../src/platform/compat/process.ts";
import { isTruthyEnvValue, refreshLoggerConfig } from "veryfront/utils";

export interface DevLogController {
  isVerbose(): boolean;
  toggle(): boolean;
}

export interface DevLogControllerRuntime {
  readonly deleteEnv: typeof deleteEnv;
  readonly getEnv: typeof getEnv;
  readonly refreshLoggerConfig: typeof refreshLoggerConfig;
  readonly setEnv: typeof setEnv;
}

const hostRuntime: DevLogControllerRuntime = {
  deleteEnv,
  getEnv,
  refreshLoggerConfig,
  setEnv,
};

function startsVerbose(runtime: DevLogControllerRuntime): boolean {
  const level = runtime.getEnv("LOG_LEVEL")?.toUpperCase();
  return level === "DEBUG" ||
    isTruthyEnvValue(runtime.getEnv("VERYFRONT_DEBUG"));
}

export function createDevLogController(
  runtime: DevLogControllerRuntime = hostRuntime,
): DevLogController {
  let verbose = startsVerbose(runtime);
  const initialLevel = runtime.getEnv("LOG_LEVEL");
  const normalLevel = initialLevel?.toUpperCase() === "DEBUG" ? "INFO" : initialLevel;

  return {
    isVerbose: () => verbose,
    toggle: () => {
      verbose = !verbose;

      if (verbose) {
        runtime.setEnv("LOG_LEVEL", "DEBUG");
        runtime.setEnv("VERYFRONT_DEBUG", "1");
      } else if (normalLevel === undefined) {
        runtime.deleteEnv("LOG_LEVEL");
      } else {
        runtime.setEnv("LOG_LEVEL", normalLevel);
      }

      if (!verbose) runtime.deleteEnv("VERYFRONT_DEBUG");

      runtime.refreshLoggerConfig();
      return verbose;
    },
  };
}
