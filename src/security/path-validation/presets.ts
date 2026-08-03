import type { PathValidationPolicyOptions } from "./types.ts";

const USER_INPUT_ALLOWED_DIRS = [
  "app",
  "pages",
  "public",
  "components",
  "lib",
  "src",
  "utils",
  "helpers",
  "hooks",
  "services",
  "styles",
  "assets",
  "constants",
  "types",
  "api",
] as const;

function createPreset(
  baseDir: string,
  options: Omit<PathValidationPolicyOptions, "baseDir">,
): PathValidationPolicyOptions {
  return {
    baseDir,
    ...options,
  };
}

const INTERNAL_PRESET: Omit<PathValidationPolicyOptions, "baseDir"> = {
  level: "normal",
  followSymlinks: false,
  checkExists: false,
  allowAbsolute: false,
};

const BUILD_PRESET: Omit<PathValidationPolicyOptions, "baseDir"> = {
  level: "normal",
  followSymlinks: true,
  checkExists: false,
  allowAbsolute: true,
};

export const ValidationPresets = {
  userInput(baseDir: string): PathValidationPolicyOptions {
    return createPreset(baseDir, {
      level: "strict",
      allowedDirs: [...USER_INPUT_ALLOWED_DIRS],
      followSymlinks: false,
      checkExists: true,
      allowAbsolute: false,
    });
  },

  internal(baseDir: string): PathValidationPolicyOptions {
    return createPreset(baseDir, INTERNAL_PRESET);
  },

  build(baseDir: string): PathValidationPolicyOptions {
    return createPreset(baseDir, BUILD_PRESET);
  },

  static(baseDir: string): PathValidationPolicyOptions {
    return createPreset(baseDir, {
      level: "normal",
      allowedDirs: ["dist", "public"],
      followSymlinks: false,
      checkExists: true,
      allowAbsolute: false,
    });
  },
};
