export const READ_OPERATION_EXTENSION_PRIORITY = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mdx",
  ".md",
] as const;

// Intentionally different from read order to preserve existing stat/resolve semantics.
export const STAT_OPERATION_EXTENSION_PRIORITY = [
  ".mdx",
  ".md",
  ".tsx",
  ".jsx",
  ".ts",
  ".js",
] as const;
