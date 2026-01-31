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

export const ValidationPresets = {
  userInput(baseDir: string): ValidationOptions {
    return {
      baseDir,
      level: "strict",
      allowedDirs: [...USER_INPUT_ALLOWED_DIRS],
      followSymlinks: false,
      checkExists: true,
      allowAbsolute: false,
    };
  },

  internal(baseDir: string): ValidationOptions {
    return {
      baseDir,
      level: "normal",
      followSymlinks: false,
      checkExists: false,
      allowAbsolute: false,
    };
  },

  build(baseDir: string): ValidationOptions {
    return {
      baseDir,
      level: "permissive",
      followSymlinks: true,
      checkExists: false,
      allowAbsolute: true,
    };
  },

  static(baseDir: string): ValidationOptions {
    return {
      baseDir,
      level: "normal",
      allowedDirs: ["dist", "public"],
      followSymlinks: false,
      checkExists: true,
      allowAbsolute: false,
    };
  },
};
