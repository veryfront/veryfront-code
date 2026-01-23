export const ErrorCode = {
  CONFIG_NOT_FOUND: "VF001",
  CONFIG_INVALID: "VF002",
  CONFIG_PARSE_ERROR: "VF003",
  CONFIG_VALIDATION_ERROR: "VF004",
  CONFIG_TYPE_ERROR: "VF005",
  IMPORT_MAP_INVALID: "VF006",
  CORS_CONFIG_INVALID: "VF007",

  BUILD_FAILED: "VF100",
  BUNDLE_ERROR: "VF101",
  TYPESCRIPT_ERROR: "VF102",
  MDX_COMPILE_ERROR: "VF103",
  ASSET_OPTIMIZATION_ERROR: "VF104",
  SSG_GENERATION_ERROR: "VF105",
  SOURCEMAP_ERROR: "VF106",

  HYDRATION_MISMATCH: "VF200",
  RENDER_ERROR: "VF201",
  COMPONENT_ERROR: "VF202",
  LAYOUT_NOT_FOUND: "VF203",
  PAGE_NOT_FOUND: "VF204",
  API_ERROR: "VF205",
  MIDDLEWARE_ERROR: "VF206",

  ROUTE_CONFLICT: "VF300",
  INVALID_ROUTE_FILE: "VF301",
  ROUTE_HANDLER_INVALID: "VF302",
  DYNAMIC_ROUTE_ERROR: "VF303",
  ROUTE_PARAMS_ERROR: "VF304",
  API_ROUTE_ERROR: "VF305",

  MODULE_NOT_FOUND: "VF400",
  IMPORT_RESOLUTION_ERROR: "VF401",
  CIRCULAR_DEPENDENCY: "VF402",
  INVALID_IMPORT: "VF403",
  DEPENDENCY_MISSING: "VF404",
  VERSION_MISMATCH: "VF405",

  PORT_IN_USE: "VF500",
  SERVER_START_ERROR: "VF501",
  HMR_ERROR: "VF502",
  CACHE_ERROR: "VF503",
  FILE_WATCH_ERROR: "VF504",
  REQUEST_ERROR: "VF505",
  SERVICE_OVERLOADED: "VF506",

  CLIENT_BOUNDARY_VIOLATION: "VF600",
  SERVER_ONLY_IN_CLIENT: "VF601",
  CLIENT_ONLY_IN_SERVER: "VF602",
  INVALID_USE_CLIENT: "VF603",
  INVALID_USE_SERVER: "VF604",
  RSC_PAYLOAD_ERROR: "VF605",

  DEV_SERVER_ERROR: "VF700",
  FAST_REFRESH_ERROR: "VF701",
  ERROR_OVERLAY_ERROR: "VF702",
  SOURCE_MAP_ERROR: "VF703",

  DEPLOYMENT_ERROR: "VF800",
  PLATFORM_ERROR: "VF801",
  ENV_VAR_MISSING: "VF802",
  PRODUCTION_BUILD_REQUIRED: "VF803",

  UNKNOWN_ERROR: "VF900",
  PERMISSION_DENIED: "VF901",
  FILE_NOT_FOUND: "VF902",
  INVALID_ARGUMENT: "VF903",
  TIMEOUT_ERROR: "VF904",
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

export function getErrorDocsUrl(code: ErrorCodeType): string {
  return `https://veryfront.com/docs/errors/${code}`;
}

export function inferErrorCode(error: Error): ErrorCodeType | null {
  const message = error.message.toLowerCase();

  if (message.includes("config") && message.includes("not found")) {
    return ErrorCode.CONFIG_NOT_FOUND;
  }
  if (message.includes("config") && message.includes("invalid")) return ErrorCode.CONFIG_INVALID;
  if (message.includes("cors")) return ErrorCode.CORS_CONFIG_INVALID;

  if (message.includes("route") && message.includes("conflict")) return ErrorCode.ROUTE_CONFLICT;
  if (message.includes("route") && message.includes("invalid")) return ErrorCode.INVALID_ROUTE_FILE;

  if (message.includes("client") && message.includes("boundary")) {
    return ErrorCode.CLIENT_BOUNDARY_VIOLATION;
  }
  if (message.includes("server-only") && message.includes("client")) {
    return ErrorCode.SERVER_ONLY_IN_CLIENT;
  }

  if (message.includes("module not found") || message.includes("cannot find module")) {
    return ErrorCode.MODULE_NOT_FOUND;
  }
  if (message.includes("import") || message.includes("resolve")) {
    return ErrorCode.IMPORT_RESOLUTION_ERROR;
  }
  if (message.includes("react") && message.includes("not found")) {
    return ErrorCode.DEPENDENCY_MISSING;
  }

  if (message.includes("port") && (message.includes("in use") || message.includes("eaddrinuse"))) {
    return ErrorCode.PORT_IN_USE;
  }
  if (message.includes("capacity exceeded") || message.includes("service overloaded")) {
    return ErrorCode.SERVICE_OVERLOADED;
  }
  if (message.includes("hydration")) return ErrorCode.HYDRATION_MISMATCH;

  if (message.includes("build") && message.includes("fail")) return ErrorCode.BUILD_FAILED;
  if (message.includes("mdx")) return ErrorCode.MDX_COMPILE_ERROR;
  if (message.includes("typescript")) return ErrorCode.TYPESCRIPT_ERROR;

  return null;
}
