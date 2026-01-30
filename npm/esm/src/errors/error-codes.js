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
    CACHE_PATH_MISMATCH: "VF507",
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
};
export function getErrorDocsUrl(code) {
    return `https://veryfront.com/docs/errors/${code}`;
}
export function inferErrorCode(error) {
    const message = error.message.toLowerCase();
    const has = (text) => message.includes(text);
    if (has("config")) {
        if (has("not found"))
            return ErrorCode.CONFIG_NOT_FOUND;
        if (has("invalid"))
            return ErrorCode.CONFIG_INVALID;
    }
    if (has("cors"))
        return ErrorCode.CORS_CONFIG_INVALID;
    if (has("route")) {
        if (has("conflict"))
            return ErrorCode.ROUTE_CONFLICT;
        if (has("invalid"))
            return ErrorCode.INVALID_ROUTE_FILE;
    }
    if (has("client") && has("boundary"))
        return ErrorCode.CLIENT_BOUNDARY_VIOLATION;
    if (has("server-only") && has("client"))
        return ErrorCode.SERVER_ONLY_IN_CLIENT;
    if (has("cache path mismatch") || has("incompatible") && has("path")) {
        return ErrorCode.CACHE_PATH_MISMATCH;
    }
    if (has("module not found") || has("cannot find module"))
        return ErrorCode.MODULE_NOT_FOUND;
    if (has("import") || has("resolve"))
        return ErrorCode.IMPORT_RESOLUTION_ERROR;
    if (has("react") && has("not found"))
        return ErrorCode.DEPENDENCY_MISSING;
    if (has("port") && (has("in use") || has("eaddrinuse")))
        return ErrorCode.PORT_IN_USE;
    if (has("capacity exceeded") || has("service overloaded"))
        return ErrorCode.SERVICE_OVERLOADED;
    if (has("hydration"))
        return ErrorCode.HYDRATION_MISMATCH;
    if (has("build") && has("fail"))
        return ErrorCode.BUILD_FAILED;
    if (has("mdx"))
        return ErrorCode.MDX_COMPILE_ERROR;
    if (has("typescript"))
        return ErrorCode.TYPESCRIPT_ERROR;
    return null;
}
