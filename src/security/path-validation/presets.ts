import type { ValidationOptions } from "./types.ts";

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
  options: Omit<ValidationOptions, "baseDir">,
): ValidationOptions {
  return {
    baseDir,
    ...options,
  };
}

const INTERNAL_PRESET: Omit<ValidationOptions, "baseDir"> = {
  level: "normal",
  followSymlinks: false,
  checkExists: false,
  allowAbsolute: false,
};

const BUILD_PRESET: Omit<ValidationOptions, "baseDir"> = {
  level: "permissive",
  followSymlinks: true,
  checkExists: false,
  allowAbsolute: true,
};

export const ValidationPresets = {
  userInput(baseDir: string): ValidationOptions {
    return createPreset(baseDir, {
      level: "strict",
      allowedDirs: [...USER_INPUT_ALLOWED_DIRS],
      followSymlinks: false,
      checkExists: true,
      allowAbsolute: false,
    });
  },

  internal(baseDir: string): ValidationOptions {
    return createPreset(baseDir, INTERNAL_PRESET);
  },

  build(baseDir: string): ValidationOptions {
    return createPreset(baseDir, BUILD_PRESET);
  },

  static(baseDir: string): ValidationOptions {
    return createPreset(baseDir, {
      level: "normal",
      allowedDirs: ["dist", "public"],
      followSymlinks: false,
      checkExists: true,
      allowAbsolute: false,
    });
  },
};
