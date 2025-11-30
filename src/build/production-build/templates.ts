/**
 * Embedded templates for production builds
 * These are embedded as strings to avoid file system dependencies in npm bundle
 * @module
 */

/**
 * Client-side CSS styles for loading states, error display, and prose formatting
 */
export const CLIENT_STYLES = `body {
  margin: 0;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.5;
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #f9fafb;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-container {
  max-width: 600px;
  margin: 2rem auto;
  padding: 2rem;
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 8px;
  color: #c00;
}

.prose {
  max-width: 65ch;
  margin: 0 auto;
  padding: 2rem;
}

.prose h1, .prose h2, .prose h3 {
  margin-top: 2em;
  margin-bottom: 1em;
}

.prose p {
  margin-bottom: 1.5em;
}

.prose code {
  background: #f3f4f6;
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-size: 0.875em;
}

.prose pre {
  background: #1f2937;
  color: #f9fafb;
  padding: 1em;
  border-radius: 8px;
  overflow-x: auto;
}

.prose pre code {
  background: transparent;
  padding: 0;
  color: inherit;
}`;

/**
 * Pre-bundled client router script for npm builds
 * Placeholder - this is auto-generated during build:npm
 */
export const CLIENT_ROUTER_BUNDLE: string = `var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/utils/runtime-guards.ts
function hasDenoRuntime(global) {
  return typeof global === "object" && global !== null && "Deno" in global && typeof global.Deno?.env?.get === "function";
}
function hasNodeProcess(global) {
  return typeof global === "object" && global !== null && "process" in global && typeof global.process?.env === "object";
}
function hasBunRuntime(global) {
  return typeof global === "object" && global !== null && "Bun" in global && typeof global.Bun !== "undefined";
}
var init_runtime_guards = __esm({
  "src/core/utils/runtime-guards.ts"() {
    "use strict";
  }
});

// src/core/utils/logger/env.ts
function getEnvironmentVariable(name) {
  try {
    if (typeof Deno !== "undefined" && hasDenoRuntime(globalThis)) {
      const value = globalThis.Deno?.env.get(name);
      return value === "" ? void 0 : value;
    }
    if (hasNodeProcess(globalThis)) {
      const value = globalThis.process?.env[name];
      return value === "" ? void 0 : value;
    }
  } catch (error2) {
    console.debug(\`Failed to get environment variable \${name}:\`, error2);
    return void 0;
  }
  return void 0;
}
function isTestEnvironment() {
  return getEnvironmentVariable("NODE_ENV") === "test";
}
function isProductionEnvironment() {
  return getEnvironmentVariable("NODE_ENV") === "production";
}
function isDevelopmentEnvironment() {
  const env = getEnvironmentVariable("NODE_ENV");
  return env === "development" || env === void 0;
}
var init_env = __esm({
  "src/core/utils/logger/env.ts"() {
    "use strict";
    init_runtime_guards();
  }
});

// src/core/utils/logger/logger.ts
function resolveLogLevel(force = false) {
  if (force || cachedLogLevel === void 0) {
    cachedLogLevel = getDefaultLevel();
  }
  return cachedLogLevel;
}
function parseLogLevel(levelString) {
  if (!levelString)
    return void 0;
  const upper = levelString.toUpperCase();
  switch (upper) {
    case "DEBUG":
      return 0 /* DEBUG */;
    case "WARN":
      return 2 /* WARN */;
    case "ERROR":
      return 3 /* ERROR */;
    case "INFO":
      return 1 /* INFO */;
    default:
      return void 0;
  }
}
function createLogger(prefix) {
  const logger2 = new ConsoleLogger(prefix);
  trackedLoggers.add(logger2);
  return logger2;
}
function __loggerResetForTests(options = {}) {
  const updatedLevel = resolveLogLevel(true);
  for (const instance of trackedLoggers) {
    instance.setLevel(updatedLevel);
  }
  if (options.restoreConsole) {
    console.debug = originalConsole.debug;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
}
var LogLevel, originalConsole, cachedLogLevel, ConsoleLogger, getDefaultLevel, trackedLoggers, cliLogger, serverLogger, rendererLogger, bundlerLogger, agentLogger, logger;
var init_logger = __esm({
  "src/core/utils/logger/logger.ts"() {
    "use strict";
    init_env();
    LogLevel = /* @__PURE__ */ ((LogLevel2) => {
      LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
      LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
      LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
      LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
      return LogLevel2;
    })(LogLevel || {});
    originalConsole = {
      debug: console.debug,
      log: console.log,
      warn: console.warn,
      error: console.error
    };
    ConsoleLogger = class {
      constructor(prefix, level = resolveLogLevel()) {
        this.prefix = prefix;
        this.level = level;
      }
      setLevel(level) {
        this.level = level;
      }
      getLevel() {
        return this.level;
      }
      debug(message, ...args) {
        if (this.level <= 0 /* DEBUG */) {
          console.debug(\`[\${this.prefix}] DEBUG: \${message}\`, ...args);
        }
      }
      info(message, ...args) {
        if (this.level <= 1 /* INFO */) {
          console.log(\`[\${this.prefix}] \${message}\`, ...args);
        }
      }
      warn(message, ...args) {
        if (this.level <= 2 /* WARN */) {
          console.warn(\`[\${this.prefix}] WARN: \${message}\`, ...args);
        }
      }
      error(message, ...args) {
        if (this.level <= 3 /* ERROR */) {
          console.error(\`[\${this.prefix}] ERROR: \${message}\`, ...args);
        }
      }
      async time(label, fn) {
        const start = performance.now();
        try {
          const result = await fn();
          const end = performance.now();
          this.debug(\`\${label} completed in \${(end - start).toFixed(2)}ms\`);
          return result;
        } catch (_error) {
          const end = performance.now();
          this.error(\`\${label} failed after \${(end - start).toFixed(2)}ms\`, _error);
          throw _error;
        }
      }
    };
    getDefaultLevel = () => {
      const envLevel = getEnvironmentVariable("LOG_LEVEL");
      const parsedLevel = parseLogLevel(envLevel);
      if (parsedLevel !== void 0)
        return parsedLevel;
      const debugFlag = getEnvironmentVariable("VERYFRONT_DEBUG");
      if (debugFlag === "1" || debugFlag === "true")
        return 0 /* DEBUG */;
      return 1 /* INFO */;
    };
    trackedLoggers = /* @__PURE__ */ new Set();
    cliLogger = createLogger("CLI");
    serverLogger = createLogger("SERVER");
    rendererLogger = createLogger("RENDERER");
    bundlerLogger = createLogger("BUNDLER");
    agentLogger = createLogger("AGENT");
    logger = createLogger("VERYFRONT");
  }
});

// src/core/utils/logger/index.ts
var init_logger2 = __esm({
  "src/core/utils/logger/index.ts"() {
    "use strict";
    init_logger();
    init_env();
  }
});

// src/core/utils/constants/build.ts
var DEFAULT_BUILD_CONCURRENCY, IMAGE_OPTIMIZATION;
var init_build = __esm({
  "src/core/utils/constants/build.ts"() {
    "use strict";
    DEFAULT_BUILD_CONCURRENCY = 4;
    IMAGE_OPTIMIZATION = {
      DEFAULT_SIZES: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
      DEFAULT_QUALITY: 80
    };
  }
});

// src/core/utils/constants/cache.ts
var SECONDS_PER_MINUTE, MINUTES_PER_HOUR, HOURS_PER_DAY, MS_PER_SECOND, DEFAULT_LRU_MAX_ENTRIES, COMPONENT_LOADER_MAX_ENTRIES, COMPONENT_LOADER_TTL_MS, MDX_RENDERER_MAX_ENTRIES, MDX_RENDERER_TTL_MS, RENDERER_CORE_MAX_ENTRIES, RENDERER_CORE_TTL_MS, TSX_LAYOUT_MAX_ENTRIES, TSX_LAYOUT_TTL_MS, DATA_FETCHING_MAX_ENTRIES, DATA_FETCHING_TTL_MS, MDX_CACHE_TTL_PRODUCTION_MS, MDX_CACHE_TTL_DEVELOPMENT_MS, BUNDLE_CACHE_TTL_PRODUCTION_MS, BUNDLE_CACHE_TTL_DEVELOPMENT_MS, BUNDLE_MANIFEST_PROD_TTL_MS, BUNDLE_MANIFEST_DEV_TTL_MS, RSC_MANIFEST_CACHE_TTL_MS, SERVER_ACTION_DEFAULT_TTL_SEC, DENO_KV_SAFE_SIZE_LIMIT_BYTES, HTTP_CACHE_SHORT_MAX_AGE_SEC, HTTP_CACHE_MEDIUM_MAX_AGE_SEC, HTTP_CACHE_LONG_MAX_AGE_SEC, ONE_DAY_MS, CACHE_CLEANUP_INTERVAL_MS, LRU_DEFAULT_MAX_ENTRIES, LRU_DEFAULT_MAX_SIZE_BYTES, CLEANUP_INTERVAL_MULTIPLIER;
var init_cache = __esm({
  "src/core/utils/constants/cache.ts"() {
    "use strict";
    SECONDS_PER_MINUTE = 60;
    MINUTES_PER_HOUR = 60;
    HOURS_PER_DAY = 24;
    MS_PER_SECOND = 1e3;
    DEFAULT_LRU_MAX_ENTRIES = 100;
    COMPONENT_LOADER_MAX_ENTRIES = 100;
    COMPONENT_LOADER_TTL_MS = 10 * MINUTES_PER_HOUR * MS_PER_SECOND;
    MDX_RENDERER_MAX_ENTRIES = 200;
    MDX_RENDERER_TTL_MS = 10 * MINUTES_PER_HOUR * MS_PER_SECOND;
    RENDERER_CORE_MAX_ENTRIES = 100;
    RENDERER_CORE_TTL_MS = 5 * MINUTES_PER_HOUR * MS_PER_SECOND;
    TSX_LAYOUT_MAX_ENTRIES = 50;
    TSX_LAYOUT_TTL_MS = 10 * MINUTES_PER_HOUR * MS_PER_SECOND;
    DATA_FETCHING_MAX_ENTRIES = 200;
    DATA_FETCHING_TTL_MS = 10 * MINUTES_PER_HOUR * MS_PER_SECOND;
    MDX_CACHE_TTL_PRODUCTION_MS = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
    MDX_CACHE_TTL_DEVELOPMENT_MS = 5 * MINUTES_PER_HOUR * MS_PER_SECOND;
    BUNDLE_CACHE_TTL_PRODUCTION_MS = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
    BUNDLE_CACHE_TTL_DEVELOPMENT_MS = 5 * MINUTES_PER_HOUR * MS_PER_SECOND;
    BUNDLE_MANIFEST_PROD_TTL_MS = 7 * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
    BUNDLE_MANIFEST_DEV_TTL_MS = MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
    RSC_MANIFEST_CACHE_TTL_MS = 5e3;
    SERVER_ACTION_DEFAULT_TTL_SEC = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
    DENO_KV_SAFE_SIZE_LIMIT_BYTES = 64e3;
    HTTP_CACHE_SHORT_MAX_AGE_SEC = 60;
    HTTP_CACHE_MEDIUM_MAX_AGE_SEC = 3600;
    HTTP_CACHE_LONG_MAX_AGE_SEC = 31536e3;
    ONE_DAY_MS = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
    CACHE_CLEANUP_INTERVAL_MS = 6e4;
    LRU_DEFAULT_MAX_ENTRIES = 1e3;
    LRU_DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024;
    CLEANUP_INTERVAL_MULTIPLIER = 2;
  }
});

// src/core/utils/constants/cdn.ts
function getReactCDNUrl(version = REACT_DEFAULT_VERSION) {
  return \`\${ESM_CDN_BASE}/react@\${version}\`;
}
function getReactDOMCDNUrl(version = REACT_DEFAULT_VERSION) {
  return \`\${ESM_CDN_BASE}/react-dom@\${version}\`;
}
function getReactDOMClientCDNUrl(version = REACT_DEFAULT_VERSION) {
  return \`\${ESM_CDN_BASE}/react-dom@\${version}/client\`;
}
function getReactDOMServerCDNUrl(version = REACT_DEFAULT_VERSION) {
  return \`\${ESM_CDN_BASE}/react-dom@\${version}/server\`;
}
function getReactJSXRuntimeCDNUrl(version = REACT_DEFAULT_VERSION) {
  return \`\${ESM_CDN_BASE}/react@\${version}/jsx-runtime\`;
}
function getReactJSXDevRuntimeCDNUrl(version = REACT_DEFAULT_VERSION) {
  return \`\${ESM_CDN_BASE}/react@\${version}/jsx-dev-runtime\`;
}
function getReactImportMap(version = REACT_DEFAULT_VERSION) {
  return {
    react: getReactCDNUrl(version),
    "react-dom": getReactDOMCDNUrl(version),
    "react-dom/client": getReactDOMClientCDNUrl(version),
    "react-dom/server": getReactDOMServerCDNUrl(version),
    "react/jsx-runtime": getReactJSXRuntimeCDNUrl(version),
    "react/jsx-dev-runtime": getReactJSXDevRuntimeCDNUrl(version)
  };
}
function getDenoStdNodeBase() {
  return \`\${DENO_STD_BASE}/std@\${DENO_STD_VERSION}/node\`;
}
function getUnoCSSTailwindResetUrl() {
  return \`\${ESM_CDN_BASE}/@unocss/reset@\${UNOCSS_VERSION}/tailwind.css\`;
}
var ESM_CDN_BASE, JSDELIVR_CDN_BASE, DENO_STD_BASE, REACT_VERSION_17, REACT_VERSION_18_2, REACT_VERSION_18_3, REACT_VERSION_19_RC, REACT_VERSION_19, REACT_DEFAULT_VERSION, DEFAULT_ALLOWED_CDN_HOSTS, DENO_STD_VERSION, UNOCSS_VERSION;
var init_cdn = __esm({
  "src/core/utils/constants/cdn.ts"() {
    "use strict";
    ESM_CDN_BASE = "https://esm.sh";
    JSDELIVR_CDN_BASE = "https://cdn.jsdelivr.net";
    DENO_STD_BASE = "https://deno.land";
    REACT_VERSION_17 = "17.0.2";
    REACT_VERSION_18_2 = "18.2.0";
    REACT_VERSION_18_3 = "18.3.1";
    REACT_VERSION_19_RC = "19.0.0-rc.0";
    REACT_VERSION_19 = "19.1.1";
    REACT_DEFAULT_VERSION = REACT_VERSION_18_3;
    DEFAULT_ALLOWED_CDN_HOSTS = [ESM_CDN_BASE, DENO_STD_BASE];
    DENO_STD_VERSION = "0.220.0";
    UNOCSS_VERSION = "0.59.0";
  }
});

// src/core/utils/constants/hash.ts
var HASH_SEED_DJB2, HASH_SEED_FNV1A;
var init_hash = __esm({
  "src/core/utils/constants/hash.ts"() {
    "use strict";
    HASH_SEED_DJB2 = 5381;
    HASH_SEED_FNV1A = 2166136261;
  }
});

// src/core/utils/constants/http.ts
var KB_IN_BYTES, HTTP_MODULE_FETCH_TIMEOUT_MS, HMR_RECONNECT_DELAY_MS, HMR_RELOAD_DELAY_MS, HMR_FILE_WATCHER_DEBOUNCE_MS, HMR_KEEP_ALIVE_INTERVAL_MS, DASHBOARD_RECONNECT_DELAY_MS, SERVER_FUNCTION_DEFAULT_TIMEOUT_MS, PREFETCH_MAX_SIZE_BYTES, PREFETCH_DEFAULT_TIMEOUT_MS, PREFETCH_DEFAULT_DELAY_MS, HTTP_OK, HTTP_NO_CONTENT, HTTP_CREATED, HTTP_REDIRECT_FOUND, HTTP_NOT_MODIFIED, HTTP_BAD_REQUEST, HTTP_UNAUTHORIZED, HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_METHOD_NOT_ALLOWED, HTTP_GONE, HTTP_PAYLOAD_TOO_LARGE, HTTP_URI_TOO_LONG, HTTP_TOO_MANY_REQUESTS, HTTP_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_SERVER_ERROR, HTTP_INTERNAL_SERVER_ERROR, HTTP_BAD_GATEWAY, HTTP_NOT_IMPLEMENTED, HTTP_UNAVAILABLE, HTTP_NETWORK_CONNECT_TIMEOUT, HTTP_STATUS_SUCCESS_MIN, HTTP_STATUS_REDIRECT_MIN, HTTP_STATUS_CLIENT_ERROR_MIN, HTTP_STATUS_SERVER_ERROR_MIN, HTTP_CONTENT_TYPES, MS_PER_MINUTE, HTTP_CONTENT_TYPE_IMAGE_PNG, HTTP_CONTENT_TYPE_IMAGE_JPEG, HTTP_CONTENT_TYPE_IMAGE_WEBP, HTTP_CONTENT_TYPE_IMAGE_AVIF, HTTP_CONTENT_TYPE_IMAGE_SVG, HTTP_CONTENT_TYPE_IMAGE_GIF, HTTP_CONTENT_TYPE_IMAGE_ICO;
var init_http = __esm({
  "src/core/utils/constants/http.ts"() {
    "use strict";
    init_cache();
    KB_IN_BYTES = 1024;
    HTTP_MODULE_FETCH_TIMEOUT_MS = 2500;
    HMR_RECONNECT_DELAY_MS = 1e3;
    HMR_RELOAD_DELAY_MS = 1e3;
    HMR_FILE_WATCHER_DEBOUNCE_MS = 100;
    HMR_KEEP_ALIVE_INTERVAL_MS = 3e4;
    DASHBOARD_RECONNECT_DELAY_MS = 3e3;
    SERVER_FUNCTION_DEFAULT_TIMEOUT_MS = 3e4;
    PREFETCH_MAX_SIZE_BYTES = 200 * KB_IN_BYTES;
    PREFETCH_DEFAULT_TIMEOUT_MS = 1e4;
    PREFETCH_DEFAULT_DELAY_MS = 200;
    HTTP_OK = 200;
    HTTP_NO_CONTENT = 204;
    HTTP_CREATED = 201;
    HTTP_REDIRECT_FOUND = 302;
    HTTP_NOT_MODIFIED = 304;
    HTTP_BAD_REQUEST = 400;
    HTTP_UNAUTHORIZED = 401;
    HTTP_FORBIDDEN = 403;
    HTTP_NOT_FOUND = 404;
    HTTP_METHOD_NOT_ALLOWED = 405;
    HTTP_GONE = 410;
    HTTP_PAYLOAD_TOO_LARGE = 413;
    HTTP_URI_TOO_LONG = 414;
    HTTP_TOO_MANY_REQUESTS = 429;
    HTTP_REQUEST_HEADER_FIELDS_TOO_LARGE = 431;
    HTTP_SERVER_ERROR = 500;
    HTTP_INTERNAL_SERVER_ERROR = 500;
    HTTP_BAD_GATEWAY = 502;
    HTTP_NOT_IMPLEMENTED = 501;
    HTTP_UNAVAILABLE = 503;
    HTTP_NETWORK_CONNECT_TIMEOUT = 599;
    HTTP_STATUS_SUCCESS_MIN = 200;
    HTTP_STATUS_REDIRECT_MIN = 300;
    HTTP_STATUS_CLIENT_ERROR_MIN = 400;
    HTTP_STATUS_SERVER_ERROR_MIN = 500;
    HTTP_CONTENT_TYPES = {
      JS: "application/javascript; charset=utf-8",
      JSON: "application/json; charset=utf-8",
      HTML: "text/html; charset=utf-8",
      CSS: "text/css; charset=utf-8",
      TEXT: "text/plain; charset=utf-8"
    };
    MS_PER_MINUTE = 6e4;
    HTTP_CONTENT_TYPE_IMAGE_PNG = "image/png";
    HTTP_CONTENT_TYPE_IMAGE_JPEG = "image/jpeg";
    HTTP_CONTENT_TYPE_IMAGE_WEBP = "image/webp";
    HTTP_CONTENT_TYPE_IMAGE_AVIF = "image/avif";
    HTTP_CONTENT_TYPE_IMAGE_SVG = "image/svg+xml";
    HTTP_CONTENT_TYPE_IMAGE_GIF = "image/gif";
    HTTP_CONTENT_TYPE_IMAGE_ICO = "image/x-icon";
  }
});

// src/core/utils/constants/hmr.ts
function isValidHMRMessageType(type) {
  return Object.values(HMR_MESSAGE_TYPES).includes(
    type
  );
}
var HMR_MAX_MESSAGE_SIZE_BYTES, HMR_MAX_MESSAGES_PER_MINUTE, HMR_CLIENT_RELOAD_DELAY_MS, HMR_PORT_OFFSET, HMR_RATE_LIMIT_WINDOW_MS, HMR_CLOSE_NORMAL, HMR_CLOSE_RATE_LIMIT, HMR_CLOSE_MESSAGE_TOO_LARGE, HMR_MESSAGE_TYPES;
var init_hmr = __esm({
  "src/core/utils/constants/hmr.ts"() {
    "use strict";
    init_http();
    HMR_MAX_MESSAGE_SIZE_BYTES = 1024 * KB_IN_BYTES;
    HMR_MAX_MESSAGES_PER_MINUTE = 100;
    HMR_CLIENT_RELOAD_DELAY_MS = 3e3;
    HMR_PORT_OFFSET = 1;
    HMR_RATE_LIMIT_WINDOW_MS = 6e4;
    HMR_CLOSE_NORMAL = 1e3;
    HMR_CLOSE_RATE_LIMIT = 1008;
    HMR_CLOSE_MESSAGE_TOO_LARGE = 1009;
    HMR_MESSAGE_TYPES = {
      CONNECTED: "connected",
      UPDATE: "update",
      RELOAD: "reload",
      PING: "ping",
      PONG: "pong"
    };
  }
});

// src/core/utils/constants/html.ts
var Z_INDEX_DEV_INDICATOR, Z_INDEX_ERROR_OVERLAY, BREAKPOINT_SM, BREAKPOINT_MD, BREAKPOINT_LG, BREAKPOINT_XL, PROSE_MAX_WIDTH;
var init_html = __esm({
  "src/core/utils/constants/html.ts"() {
    "use strict";
    Z_INDEX_DEV_INDICATOR = 9998;
    Z_INDEX_ERROR_OVERLAY = 9999;
    BREAKPOINT_SM = 640;
    BREAKPOINT_MD = 768;
    BREAKPOINT_LG = 1024;
    BREAKPOINT_XL = 1280;
    PROSE_MAX_WIDTH = "65ch";
  }
});

// src/core/utils/constants/network.ts
var DEFAULT_DEV_SERVER_PORT, DEFAULT_REDIS_PORT, DEFAULT_API_SERVER_PORT, DEFAULT_PREVIEW_SERVER_PORT, DEFAULT_METRICS_PORT, BYTES_PER_KB, BYTES_PER_MB, DEFAULT_IMAGE_THUMBNAIL_SIZE, DEFAULT_IMAGE_SMALL_SIZE, DEFAULT_IMAGE_LARGE_SIZE, RESPONSIVE_IMAGE_WIDTH_XS, RESPONSIVE_IMAGE_WIDTH_SM, RESPONSIVE_IMAGE_WIDTH_MD, RESPONSIVE_IMAGE_WIDTH_LG, RESPONSIVE_IMAGE_WIDTHS, MAX_CHUNK_SIZE_KB, MIN_PORT, MAX_PORT, DEFAULT_SERVER_PORT;
var init_network = __esm({
  "src/core/utils/constants/network.ts"() {
    "use strict";
    DEFAULT_DEV_SERVER_PORT = 3e3;
    DEFAULT_REDIS_PORT = 6379;
    DEFAULT_API_SERVER_PORT = 8080;
    DEFAULT_PREVIEW_SERVER_PORT = 5e3;
    DEFAULT_METRICS_PORT = 9e3;
    BYTES_PER_KB = 1024;
    BYTES_PER_MB = 1024 * 1024;
    DEFAULT_IMAGE_THUMBNAIL_SIZE = 256;
    DEFAULT_IMAGE_SMALL_SIZE = 512;
    DEFAULT_IMAGE_LARGE_SIZE = 2048;
    RESPONSIVE_IMAGE_WIDTH_XS = 320;
    RESPONSIVE_IMAGE_WIDTH_SM = 640;
    RESPONSIVE_IMAGE_WIDTH_MD = 1024;
    RESPONSIVE_IMAGE_WIDTH_LG = 1920;
    RESPONSIVE_IMAGE_WIDTHS = [
      RESPONSIVE_IMAGE_WIDTH_XS,
      RESPONSIVE_IMAGE_WIDTH_SM,
      RESPONSIVE_IMAGE_WIDTH_MD,
      RESPONSIVE_IMAGE_WIDTH_LG
    ];
    MAX_CHUNK_SIZE_KB = 4096;
    MIN_PORT = 1;
    MAX_PORT = 65535;
    DEFAULT_SERVER_PORT = 8e3;
  }
});

// src/core/utils/constants/security.ts
var MAX_PATH_TRAVERSAL_DEPTH, FORBIDDEN_PATH_PATTERNS, DIRECTORY_TRAVERSAL_PATTERN, ABSOLUTE_PATH_PATTERN, MAX_PATH_LENGTH, DEFAULT_MAX_STRING_LENGTH;
var init_security = __esm({
  "src/core/utils/constants/security.ts"() {
    "use strict";
    MAX_PATH_TRAVERSAL_DEPTH = 10;
    FORBIDDEN_PATH_PATTERNS = [
      /\\0/
      // Null bytes
    ];
    DIRECTORY_TRAVERSAL_PATTERN = /\\.\\.[\\/\\\\]/;
    ABSOLUTE_PATH_PATTERN = /^[\\/\\\\]/;
    MAX_PATH_LENGTH = 4096;
    DEFAULT_MAX_STRING_LENGTH = 1e3;
  }
});

// src/core/utils/constants/server.ts
var DEFAULT_DASHBOARD_PORT, DEV_SERVER_ENDPOINTS;
var init_server = __esm({
  "src/core/utils/constants/server.ts"() {
    "use strict";
    DEFAULT_DASHBOARD_PORT = 3002;
    DEV_SERVER_ENDPOINTS = {
      HMR_RUNTIME: "/_veryfront/hmr-runtime.js",
      ERROR_OVERLAY: "/_veryfront/error-overlay.js"
    };
  }
});

// src/core/utils/constants/index.ts
var init_constants = __esm({
  "src/core/utils/constants/index.ts"() {
    "use strict";
    init_build();
    init_cache();
    init_cdn();
    init_hash();
    init_hmr();
    init_html();
    init_http();
    init_network();
    init_security();
    init_server();
  }
});

// deno.json
var deno_default;
var init_deno = __esm({
  "deno.json"() {
    deno_default = {
      name: "veryfront",
      version: "0.1.0",
      nodeModulesDir: "auto",
      workspace: [
        "./examples/async-worker-redis",
        "./examples/knowledge-base",
        "./examples/form-handling",
        "./examples/middleware-demo",
        "./examples/coding-agent",
        "./examples/durable-workflows"
      ],
      exports: {
        ".": "./src/index.ts",
        "./cli": "./src/cli/main.ts",
        "./server": "./src/server/index.ts",
        "./middleware": "./src/middleware/index.ts",
        "./components": "./src/react/components/index.ts",
        "./data": "./src/data/index.ts",
        "./config": "./src/core/config/index.ts",
        "./ai": "./src/ai/index.ts",
        "./ai/client": "./src/ai/client.ts",
        "./ai/react": "./src/ai/react/index.ts",
        "./ai/primitives": "./src/ai/react/primitives/index.ts",
        "./ai/components": "./src/ai/react/components/index.ts",
        "./ai/production": "./src/ai/production/index.ts",
        "./ai/dev": "./src/ai/dev/index.ts",
        "./ai/workflow": "./src/ai/workflow/index.ts",
        "./ai/workflow/react": "./src/ai/workflow/react/index.ts"
      },
      imports: {
        "@veryfront": "./src/index.ts",
        "@veryfront/": "./src/",
        "@veryfront/ai": "./src/ai/index.ts",
        "@veryfront/ai/": "./src/ai/",
        "@veryfront/platform": "./src/platform/index.ts",
        "@veryfront/platform/": "./src/platform/",
        "@veryfront/types": "./src/core/types/index.ts",
        "@veryfront/types/": "./src/core/types/",
        "@veryfront/utils": "./src/core/utils/index.ts",
        "@veryfront/utils/": "./src/core/utils/",
        "@veryfront/middleware": "./src/middleware/index.ts",
        "@veryfront/middleware/": "./src/middleware/",
        "@veryfront/errors": "./src/core/errors/index.ts",
        "@veryfront/errors/": "./src/core/errors/",
        "@veryfront/config": "./src/core/config/index.ts",
        "@veryfront/config/": "./src/core/config/",
        "@veryfront/observability": "./src/observability/index.ts",
        "@veryfront/observability/": "./src/observability/",
        "@veryfront/routing": "./src/routing/index.ts",
        "@veryfront/routing/": "./src/routing/",
        "@veryfront/transforms": "./src/build/transforms/index.ts",
        "@veryfront/transforms/": "./src/build/transforms/",
        "@veryfront/data": "./src/data/index.ts",
        "@veryfront/data/": "./src/data/",
        "@veryfront/security": "./src/security/index.ts",
        "@veryfront/security/": "./src/security/",
        "@veryfront/components": "./src/react/components/index.ts",
        "@veryfront/react": "./src/react/index.ts",
        "@veryfront/react/": "./src/react/",
        "@veryfront/html": "./src/html/index.ts",
        "@veryfront/html/": "./src/html/",
        "@veryfront/rendering": "./src/rendering/index.ts",
        "@veryfront/rendering/": "./src/rendering/",
        "@veryfront/build": "./src/build/index.ts",
        "@veryfront/build/": "./src/build/",
        "@veryfront/server": "./src/server/index.ts",
        "@veryfront/server/": "./src/server/",
        "@veryfront/modules": "./src/module-system/index.ts",
        "@veryfront/modules/": "./src/module-system/",
        "@veryfront/compat/console": "./src/platform/compat/console/index.ts",
        "@veryfront/compat/": "./src/platform/compat/",
        "std/": "https://deno.land/std@0.220.0/",
        "@std/path": "https://deno.land/std@0.220.0/path/mod.ts",
        "@std/testing/bdd.ts": "https://deno.land/std@0.220.0/testing/bdd.ts",
        "@std/expect": "https://deno.land/std@0.220.0/expect/mod.ts",
        csstype: "https://esm.sh/csstype@3.2.3",
        "@types/react": "https://esm.sh/@types/react@18.3.27?deps=csstype@3.2.3",
        "@types/react-dom": "https://esm.sh/@types/react-dom@18.3.7?deps=csstype@3.2.3",
        react: "https://esm.sh/react@18.3.1",
        "react-dom": "https://esm.sh/react-dom@18.3.1",
        "react-dom/server": "https://esm.sh/react-dom@18.3.1/server",
        "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
        "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
        "react/jsx-dev-runtime": "https://esm.sh/react@18.3.1/jsx-dev-runtime",
        "@mdx-js/mdx": "https://esm.sh/@mdx-js/mdx@3.0.0?deps=react@18.3.1,react-dom@18.3.1",
        "@mdx-js/react": "https://esm.sh/@mdx-js/react@3.0.0?deps=react@18.3.1,react-dom@18.3.1",
        "unist-util-visit": "https://esm.sh/unist-util-visit@5.0.0",
        "mdast-util-to-string": "https://esm.sh/mdast-util-to-string@4.0.0",
        "github-slugger": "https://esm.sh/github-slugger@2.0.0",
        "remark-gfm": "https://esm.sh/remark-gfm@4.0.1",
        "remark-frontmatter": "https://esm.sh/remark-frontmatter@5.0.0",
        "rehype-highlight": "https://esm.sh/rehype-highlight@7.0.2",
        "rehype-slug": "https://esm.sh/rehype-slug@6.0.0",
        esbuild: "https://deno.land/x/esbuild@v0.20.1/wasm.js",
        "esbuild/mod.js": "https://deno.land/x/esbuild@v0.20.1/mod.js",
        zod: "https://esm.sh/zod@3.22.0",
        "mime-types": "https://esm.sh/mime-types@2.1.35",
        mdast: "https://esm.sh/@types/mdast@4.0.3",
        hast: "https://esm.sh/@types/hast@3.0.3",
        unist: "https://esm.sh/@types/unist@3.0.2",
        unified: "https://esm.sh/unified@11.0.5?dts",
        ai: "https://esm.sh/ai@5.0.76",
        "ai/react": "https://esm.sh/@ai-sdk/react@2.0.59",
        "@ai-sdk/openai": "https://esm.sh/@ai-sdk/openai@2.0.1",
        "@ai-sdk/anthropic": "https://esm.sh/@ai-sdk/anthropic@2.0.4",
        unocss: "https://esm.sh/unocss@0.59.0",
        "@unocss/core": "https://esm.sh/@unocss/core@0.59.0",
        "@unocss/preset-wind": "https://esm.sh/@unocss/preset-wind@0.59.0"
      },
      compilerOptions: {
        jsx: "react-jsx",
        jsxImportSource: "react",
        strict: true,
        noImplicitAny: true,
        noUncheckedIndexedAccess: true,
        types: [],
        lib: [
          "deno.window",
          "dom",
          "dom.iterable",
          "dom.asynciterable",
          "deno.ns"
        ]
      },
      tasks: {
        setup: "deno run --allow-all scripts/setup.ts",
        dev: "deno run --allow-all --no-lock --unstable-net --unstable-worker-options src/cli/main.ts dev",
        build: "deno compile --allow-all --output ../../bin/veryfront src/cli/main.ts",
        "build:npm": "deno run -A scripts/build-npm.ts",
        test: "DENO_JOBS=1 deno test --parallel --fail-fast --allow-all --unstable-worker-options --unstable-net",
        "test:unit": "DENO_JOBS=1 deno test --parallel --allow-all --v8-flags=--max-old-space-size=8192 --ignore=tests --unstable-worker-options --unstable-net",
        "test:integration": "DENO_JOBS=1 deno test --parallel --fail-fast --allow-all tests --unstable-worker-options --unstable-net",
        "test:batches": "deno run --allow-all scripts/test-batches.ts",
        "test:unsafe": "DENO_JOBS=1 deno test --parallel --fail-fast --allow-all --coverage=coverage --unstable-worker-options --unstable-net",
        "test:coverage": "rm -rf coverage && DENO_JOBS=1 deno test --parallel --fail-fast --allow-all --coverage=coverage --unstable-worker-options --unstable-net || exit 1",
        "test:coverage:unit": "rm -rf coverage && DENO_JOBS=1 deno test --parallel --fail-fast --allow-all --coverage=coverage --ignore=tests --unstable-worker-options --unstable-net || exit 1",
        "test:coverage:integration": "rm -rf coverage && DENO_JOBS=1 deno test --parallel --fail-fast --allow-all --coverage=coverage tests --unstable-worker-options --unstable-net || exit 1",
        "coverage:report": "deno coverage coverage --include=src/ --exclude=tests --exclude=src/**/*_test.ts --exclude=src/**/*_test.tsx --exclude=src/**/*.test.ts --exclude=src/**/*.test.tsx --lcov > coverage/lcov.info && deno run --allow-read scripts/check-coverage.ts 80",
        "coverage:html": "deno coverage coverage --include=src/ --exclude=tests --exclude=src/**/*_test.ts --exclude=src/**/*_test.tsx --exclude=src/**/*.test.ts --exclude=src/**/*.test.tsx --html",
        lint: "deno lint src/",
        fmt: "deno fmt src/",
        typecheck: "deno check src/index.ts src/cli/main.ts src/server/index.ts src/routing/api/index.ts src/rendering/index.ts src/platform/index.ts src/platform/adapters/index.ts src/build/index.ts src/build/production-build/index.ts src/build/transforms/index.ts src/core/config/index.ts src/core/utils/index.ts src/data/index.ts src/security/index.ts src/middleware/index.ts src/server/handlers/dev/index.ts src/server/handlers/request/api/index.ts src/rendering/cache/index.ts src/rendering/cache/stores/index.ts src/rendering/rsc/actions/index.ts src/html/index.ts src/module-system/index.ts",
        "docs:check-links": "deno run -A scripts/check-doc-links.ts",
        "lint:ban-console": "deno run --allow-read scripts/ban-console.ts",
        "lint:ban-deep-imports": "deno run --allow-read scripts/ban-deep-imports.ts",
        "lint:ban-internal-root-imports": "deno run --allow-read scripts/ban-internal-root-imports.ts",
        "lint:check-awaits": "deno run --allow-read scripts/check-unawaited-promises.ts",
        "check:circular": "deno run -A jsr:@cunarist/deno-circular-deps src/index.ts"
      },
      lint: {
        include: [
          "src/**/*.ts",
          "src/**/*.tsx"
        ],
        exclude: [
          "dist/",
          "coverage/"
        ],
        rules: {
          tags: [
            "recommended"
          ],
          include: [
            "ban-untagged-todo"
          ],
          exclude: [
            "no-explicit-any",
            "no-process-global",
            "no-console"
          ]
        }
      },
      fmt: {
        include: [
          "src/**/*.ts",
          "src/**/*.tsx"
        ],
        exclude: [
          "dist/",
          "coverage/"
        ],
        options: {
          useTabs: false,
          lineWidth: 100,
          indentWidth: 2,
          semiColons: true,
          singleQuote: false,
          proseWrap: "preserve"
        }
      }
    };
  }
});

// src/core/utils/version.ts
var VERSION;
var init_version = __esm({
  "src/core/utils/version.ts"() {
    "use strict";
    init_deno();
    VERSION = typeof deno_default.version === "string" ? deno_default.version : "0.0.0";
  }
});

// src/core/utils/paths.ts
var PATHS, VERYFRONT_PATHS, FILE_EXTENSIONS;
var init_paths = __esm({
  "src/core/utils/paths.ts"() {
    "use strict";
    PATHS = {
      PAGES_DIR: "pages",
      COMPONENTS_DIR: "components",
      PUBLIC_DIR: "public",
      STYLES_DIR: "styles",
      DIST_DIR: "dist",
      CONFIG_FILE: "veryfront.config.js"
    };
    VERYFRONT_PATHS = {
      INTERNAL_PREFIX: "/_veryfront",
      BUILD_DIR: "_veryfront",
      CHUNKS_DIR: "_veryfront/chunks",
      DATA_DIR: "_veryfront/data",
      ASSETS_DIR: "_veryfront/assets",
      HMR_RUNTIME: "/_veryfront/hmr-runtime.js",
      CLIENT_JS: "/_veryfront/client.js",
      ROUTER_JS: "/_veryfront/router.js",
      ERROR_OVERLAY: "/_veryfront/error-overlay.js"
    };
    FILE_EXTENSIONS = {
      MDX: [".mdx", ".md"],
      SCRIPT: [".tsx", ".ts", ".jsx", ".js"],
      STYLE: [".css", ".scss", ".sass"],
      ALL: [".mdx", ".md", ".tsx", ".ts", ".jsx", ".js", ".css"]
    };
  }
});

// src/core/utils/hash-utils.ts
async function computeHash(content) {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
function getContentHash(content) {
  return computeHash(content);
}
function computeContentHash(content) {
  return computeHash(content);
}
function computeCodeHash(code) {
  const combined = code.code + (code.css || "") + (code.sourceMap || "");
  return computeHash(combined);
}
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
async function shortHash(content) {
  const fullHash = await computeHash(content);
  return fullHash.slice(0, 8);
}
var init_hash_utils = __esm({
  "src/core/utils/hash-utils.ts"() {
    "use strict";
  }
});

// src/core/utils/memoize.ts
function memoizeAsync(fn, keyHasher) {
  const cache = new MemoCache();
  return async (...args) => {
    const key = keyHasher(...args);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const result = await fn(...args);
    cache.set(key, result);
    return result;
  };
}
function memoize(fn, keyHasher) {
  const cache = new MemoCache();
  return (...args) => {
    const key = keyHasher(...args);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}
function simpleHash2(...values) {
  const FNV_OFFSET_BASIS = 2166136261;
  const FNV_PRIME = 16777619;
  let hash = FNV_OFFSET_BASIS;
  for (const value of values) {
    const str = typeof value === "string" ? value : String(value);
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }
  }
  return (hash >>> 0).toString(36);
}
var MemoCache;
var init_memoize = __esm({
  "src/core/utils/memoize.ts"() {
    "use strict";
    MemoCache = class {
      constructor() {
        this.cache = /* @__PURE__ */ new Map();
      }
      get(key) {
        return this.cache.get(key);
      }
      set(key, value) {
        this.cache.set(key, value);
      }
      has(key) {
        return this.cache.has(key);
      }
      clear() {
        this.cache.clear();
      }
      size() {
        return this.cache.size;
      }
    };
  }
});

// src/core/utils/path-utils.ts
function normalizePath(pathname) {
  pathname = pathname.replace(/\\\\+/g, "/").replace(/\\/\\.+\\//g, "/");
  if (pathname !== "/" && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  return pathname;
}
function joinPath(a, b) {
  return \`\${a.replace(/\\/\$/, "")}/\${b.replace(/^\\//, "")}\`;
}
function isWithinDirectory(root, target) {
  const normalizedRoot = normalizePath(root);
  const normalizedTarget = normalizePath(target);
  return normalizedTarget.startsWith(\`\${normalizedRoot}/\`) || normalizedTarget === normalizedRoot;
}
function getExtension(path) {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) {
    return "";
  }
  return path.slice(lastDot);
}
function getDirectory(path) {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : normalized.slice(0, lastSlash);
}
function hasHashedFilename(path) {
  return /\\.[a-f0-9]{8,}\\./.test(path);
}
function isAbsolutePath(path) {
  return path.startsWith("/") || /^[A-Za-z]:[\\\\/]/.test(path);
}
function toBase64Url(s) {
  const b64 = btoa(s);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function fromBase64Url(encoded) {
  const b64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const pad = b64.length % 4 === 2 ? "==" : b64.length % 4 === 3 ? "=" : "";
  try {
    return atob(b64 + pad);
  } catch (error2) {
    logger.debug(\`Failed to decode base64url string "\${encoded}":\`, error2);
    return "";
  }
}
var init_path_utils = __esm({
  "src/core/utils/path-utils.ts"() {
    "use strict";
    init_logger();
  }
});

// src/core/utils/format-utils.ts
function formatBytes(bytes) {
  if (bytes === 0)
    return "0 Bytes";
  const absBytes = Math.abs(bytes);
  if (absBytes < 1) {
    return \`\${absBytes} Bytes\`;
  }
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(absBytes) / Math.log(k));
  const index = Math.max(0, Math.min(i, sizes.length - 1));
  return \`\${parseFloat((absBytes / Math.pow(k, index)).toFixed(2))} \${sizes[index]}\`;
}
function estimateSize(value) {
  if (value === null || value === void 0)
    return 8;
  switch (typeof value) {
    case "boolean":
      return 4;
    case "number":
      return 8;
    case "string":
      return value.length * 2;
    case "function":
      return 0;
    case "object":
      return estimateObjectSize(value);
    default:
      return 32;
  }
}
function estimateSizeWithCircularHandling(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  const encoder = new TextEncoder();
  const json3 = JSON.stringify(value, (_key, val) => {
    if (typeof val === "object" && val !== null) {
      if (seen.has(val))
        return void 0;
      seen.add(val);
      if (val instanceof Map) {
        return { __type: "Map", entries: Array.from(val.entries()) };
      }
      if (val instanceof Set) {
        return { __type: "Set", values: Array.from(val.values()) };
      }
    }
    if (typeof val === "function")
      return void 0;
    if (val instanceof Uint8Array) {
      return { __type: "Uint8Array", length: val.length };
    }
    return val;
  });
  return encoder.encode(json3 ?? "").length;
}
function estimateObjectSize(value) {
  if (value instanceof ArrayBuffer)
    return value.byteLength;
  if (value instanceof Uint8Array || value instanceof Uint16Array || value instanceof Uint32Array || value instanceof Int8Array || value instanceof Int16Array || value instanceof Int32Array) {
    return value.byteLength;
  }
  try {
    return JSON.stringify(value).length * 2;
  } catch (error2) {
    logger.debug("Failed to estimate size of non-serializable object:", error2);
    return 1024;
  }
}
function formatDuration(ms) {
  if (ms < 1e3)
    return \`\${ms}ms\`;
  if (ms < 6e4)
    return \`\${(ms / 1e3).toFixed(1)}s\`;
  if (ms < 36e5)
    return \`\${Math.floor(ms / 6e4)}m \${Math.floor(ms % 6e4 / 1e3)}s\`;
  return \`\${Math.floor(ms / 36e5)}h \${Math.floor(ms % 36e5 / 6e4)}m\`;
}
function formatNumber(num) {
  return num.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
}
function truncateString(str, maxLength) {
  if (str.length <= maxLength)
    return str;
  return str.slice(0, maxLength - 3) + "...";
}
var init_format_utils = __esm({
  "src/core/utils/format-utils.ts"() {
    "use strict";
    init_logger();
  }
});

// src/core/utils/bundle-manifest.ts
function setBundleManifestStore(store) {
  manifestStore = store;
  serverLogger.info("[bundle-manifest] Bundle manifest store configured", {
    type: store.constructor.name
  });
}
function getBundleManifestStore() {
  return manifestStore;
}
var InMemoryBundleManifestStore, manifestStore;
var init_bundle_manifest = __esm({
  "src/core/utils/bundle-manifest.ts"() {
    "use strict";
    init_logger2();
    init_hash_utils();
    InMemoryBundleManifestStore = class {
      constructor() {
        this.metadata = /* @__PURE__ */ new Map();
        this.code = /* @__PURE__ */ new Map();
        this.sourceIndex = /* @__PURE__ */ new Map();
      }
      getBundleMetadata(key) {
        const entry = this.metadata.get(key);
        if (!entry)
          return Promise.resolve(void 0);
        if (entry.expiry && Date.now() > entry.expiry) {
          this.metadata.delete(key);
          return Promise.resolve(void 0);
        }
        return Promise.resolve(entry.value);
      }
      setBundleMetadata(key, metadata, ttlMs) {
        const expiry = ttlMs ? Date.now() + ttlMs : void 0;
        this.metadata.set(key, { value: metadata, expiry });
        if (!this.sourceIndex.has(metadata.source)) {
          this.sourceIndex.set(metadata.source, /* @__PURE__ */ new Set());
        }
        this.sourceIndex.get(metadata.source).add(key);
        return Promise.resolve();
      }
      getBundleCode(hash) {
        const entry = this.code.get(hash);
        if (!entry)
          return Promise.resolve(void 0);
        if (entry.expiry && Date.now() > entry.expiry) {
          this.code.delete(hash);
          return Promise.resolve(void 0);
        }
        return Promise.resolve(entry.value);
      }
      setBundleCode(hash, code, ttlMs) {
        const expiry = ttlMs ? Date.now() + ttlMs : void 0;
        this.code.set(hash, { value: code, expiry });
        return Promise.resolve();
      }
      async deleteBundle(key) {
        const metadata = await this.getBundleMetadata(key);
        this.metadata.delete(key);
        if (metadata) {
          this.code.delete(metadata.codeHash);
          const sourceKeys = this.sourceIndex.get(metadata.source);
          if (sourceKeys) {
            sourceKeys.delete(key);
            if (sourceKeys.size === 0) {
              this.sourceIndex.delete(metadata.source);
            }
          }
        }
      }
      async invalidateSource(source) {
        const keys = this.sourceIndex.get(source);
        if (!keys)
          return 0;
        let count = 0;
        for (const key of Array.from(keys)) {
          await this.deleteBundle(key);
          count++;
        }
        this.sourceIndex.delete(source);
        return count;
      }
      clear() {
        this.metadata.clear();
        this.code.clear();
        this.sourceIndex.clear();
        return Promise.resolve();
      }
      isAvailable() {
        return Promise.resolve(true);
      }
      getStats() {
        let totalSize = 0;
        let oldest;
        let newest;
        for (const { value } of this.metadata.values()) {
          totalSize += value.size;
          if (!oldest || value.compiledAt < oldest)
            oldest = value.compiledAt;
          if (!newest || value.compiledAt > newest)
            newest = value.compiledAt;
        }
        return Promise.resolve({
          totalBundles: this.metadata.size,
          totalSize,
          oldestBundle: oldest,
          newestBundle: newest
        });
      }
    };
    manifestStore = new InMemoryBundleManifestStore();
  }
});

// src/core/utils/bundle-manifest-init.ts
async function initializeBundleManifest(config, mode, adapter) {
  const manifestConfig = config.cache?.bundleManifest;
  const enabled = manifestConfig?.enabled ?? mode === "production";
  if (!enabled) {
    serverLogger.info("[bundle-manifest] Bundle manifest disabled");
    setBundleManifestStore(new InMemoryBundleManifestStore());
    return;
  }
  const envType = adapter?.env.get("VERYFRONT_BUNDLE_MANIFEST_TYPE");
  const storeType = manifestConfig?.type || envType || "memory";
  serverLogger.info("[bundle-manifest] Initializing bundle manifest", {
    type: storeType,
    mode
  });
  try {
    let store;
    switch (storeType) {
      case "redis": {
        const { RedisBundleManifestStore } = await import("./bundle-manifest-redis.ts");
        const redisUrl = manifestConfig?.redisUrl || adapter?.env.get("VERYFRONT_BUNDLE_MANIFEST_REDIS_URL");
        store = new RedisBundleManifestStore(
          {
            url: redisUrl,
            keyPrefix: manifestConfig?.keyPrefix
          },
          adapter
        );
        const available = await store.isAvailable();
        if (!available) {
          serverLogger.warn("[bundle-manifest] Redis not available, falling back to in-memory");
          store = new InMemoryBundleManifestStore();
        } else {
          serverLogger.info("[bundle-manifest] Redis store initialized");
        }
        break;
      }
      case "kv": {
        const { KVBundleManifestStore } = await import("./bundle-manifest-kv.ts");
        store = new KVBundleManifestStore({
          keyPrefix: manifestConfig?.keyPrefix
        });
        const available = await store.isAvailable();
        if (!available) {
          serverLogger.warn("[bundle-manifest] KV not available, falling back to in-memory");
          store = new InMemoryBundleManifestStore();
        } else {
          serverLogger.info("[bundle-manifest] KV store initialized");
        }
        break;
      }
      case "memory":
      default: {
        store = new InMemoryBundleManifestStore();
        serverLogger.info("[bundle-manifest] In-memory store initialized");
        break;
      }
    }
    setBundleManifestStore(store);
    try {
      const stats = await store.getStats();
      serverLogger.info("[bundle-manifest] Store statistics", stats);
    } catch (error2) {
      serverLogger.debug("[bundle-manifest] Failed to get stats", { error: error2 });
    }
  } catch (error2) {
    serverLogger.error("[bundle-manifest] Failed to initialize store, using in-memory fallback", {
      error: error2
    });
    setBundleManifestStore(new InMemoryBundleManifestStore());
  }
}
function getBundleManifestTTL(config, mode) {
  const manifestConfig = config.cache?.bundleManifest;
  if (manifestConfig?.ttl) {
    return manifestConfig.ttl;
  }
  if (mode === "production") {
    return BUNDLE_MANIFEST_PROD_TTL_MS;
  } else {
    return BUNDLE_MANIFEST_DEV_TTL_MS;
  }
}
async function warmupBundleManifest(store, keys) {
  serverLogger.info("[bundle-manifest] Warming up cache", { keys: keys.length });
  let loaded = 0;
  let failed = 0;
  for (const key of keys) {
    try {
      const metadata = await store.getBundleMetadata(key);
      if (metadata) {
        await store.getBundleCode(metadata.codeHash);
        loaded++;
      }
    } catch (error2) {
      serverLogger.debug("[bundle-manifest] Failed to warm up key", { key, error: error2 });
      failed++;
    }
  }
  serverLogger.info("[bundle-manifest] Cache warmup complete", { loaded, failed });
}
var init_bundle_manifest_init = __esm({
  "src/core/utils/bundle-manifest-init.ts"() {
    "use strict";
    init_logger2();
    init_bundle_manifest();
    init_cache();
  }
});

// src/core/utils/feature-flags.ts
function isRSCEnabled(config) {
  if (config?.experimental?.rsc !== void 0) {
    return config.experimental.rsc;
  }
  if (typeof Deno !== "undefined" && Deno.env) {
    return Deno.env.get("VERYFRONT_EXPERIMENTAL_RSC") === "1";
  }
  if (typeof process !== "undefined" && process?.env) {
    return process.env.VERYFRONT_EXPERIMENTAL_RSC === "1";
  }
  return false;
}
var init_feature_flags = __esm({
  "src/core/utils/feature-flags.ts"() {
    "use strict";
  }
});

// src/core/utils/platform.ts
function isCompiledBinary() {
  const hasDeno = typeof Deno !== "undefined";
  const hasExecPath = hasDeno && typeof Deno.execPath === "function";
  if (!hasExecPath)
    return false;
  try {
    const execPath = Deno.execPath();
    return execPath.includes("veryfront");
  } catch {
    return false;
  }
}
var init_platform = __esm({
  "src/core/utils/platform.ts"() {
    "use strict";
  }
});

// src/core/utils/index.ts
var utils_exports = {};
__export(utils_exports, {
  ABSOLUTE_PATH_PATTERN: () => ABSOLUTE_PATH_PATTERN,
  BREAKPOINT_LG: () => BREAKPOINT_LG,
  BREAKPOINT_MD: () => BREAKPOINT_MD,
  BREAKPOINT_SM: () => BREAKPOINT_SM,
  BREAKPOINT_XL: () => BREAKPOINT_XL,
  BUNDLE_CACHE_TTL_DEVELOPMENT_MS: () => BUNDLE_CACHE_TTL_DEVELOPMENT_MS,
  BUNDLE_CACHE_TTL_PRODUCTION_MS: () => BUNDLE_CACHE_TTL_PRODUCTION_MS,
  BUNDLE_MANIFEST_DEV_TTL_MS: () => BUNDLE_MANIFEST_DEV_TTL_MS,
  BUNDLE_MANIFEST_PROD_TTL_MS: () => BUNDLE_MANIFEST_PROD_TTL_MS,
  BYTES_PER_KB: () => BYTES_PER_KB,
  BYTES_PER_MB: () => BYTES_PER_MB,
  CACHE_CLEANUP_INTERVAL_MS: () => CACHE_CLEANUP_INTERVAL_MS,
  CLEANUP_INTERVAL_MULTIPLIER: () => CLEANUP_INTERVAL_MULTIPLIER,
  COMPONENT_LOADER_MAX_ENTRIES: () => COMPONENT_LOADER_MAX_ENTRIES,
  COMPONENT_LOADER_TTL_MS: () => COMPONENT_LOADER_TTL_MS,
  DASHBOARD_RECONNECT_DELAY_MS: () => DASHBOARD_RECONNECT_DELAY_MS,
  DATA_FETCHING_MAX_ENTRIES: () => DATA_FETCHING_MAX_ENTRIES,
  DATA_FETCHING_TTL_MS: () => DATA_FETCHING_TTL_MS,
  DEFAULT_ALLOWED_CDN_HOSTS: () => DEFAULT_ALLOWED_CDN_HOSTS,
  DEFAULT_API_SERVER_PORT: () => DEFAULT_API_SERVER_PORT,
  DEFAULT_BUILD_CONCURRENCY: () => DEFAULT_BUILD_CONCURRENCY,
  DEFAULT_DASHBOARD_PORT: () => DEFAULT_DASHBOARD_PORT,
  DEFAULT_DEV_SERVER_PORT: () => DEFAULT_DEV_SERVER_PORT,
  DEFAULT_IMAGE_LARGE_SIZE: () => DEFAULT_IMAGE_LARGE_SIZE,
  DEFAULT_IMAGE_SMALL_SIZE: () => DEFAULT_IMAGE_SMALL_SIZE,
  DEFAULT_IMAGE_THUMBNAIL_SIZE: () => DEFAULT_IMAGE_THUMBNAIL_SIZE,
  DEFAULT_LRU_MAX_ENTRIES: () => DEFAULT_LRU_MAX_ENTRIES,
  DEFAULT_MAX_STRING_LENGTH: () => DEFAULT_MAX_STRING_LENGTH,
  DEFAULT_METRICS_PORT: () => DEFAULT_METRICS_PORT,
  DEFAULT_PREVIEW_SERVER_PORT: () => DEFAULT_PREVIEW_SERVER_PORT,
  DEFAULT_REDIS_PORT: () => DEFAULT_REDIS_PORT,
  DEFAULT_SERVER_PORT: () => DEFAULT_SERVER_PORT,
  DENO_KV_SAFE_SIZE_LIMIT_BYTES: () => DENO_KV_SAFE_SIZE_LIMIT_BYTES,
  DENO_STD_BASE: () => DENO_STD_BASE,
  DENO_STD_VERSION: () => DENO_STD_VERSION,
  DEV_SERVER_ENDPOINTS: () => DEV_SERVER_ENDPOINTS,
  DIRECTORY_TRAVERSAL_PATTERN: () => DIRECTORY_TRAVERSAL_PATTERN,
  ESM_CDN_BASE: () => ESM_CDN_BASE,
  FILE_EXTENSIONS: () => FILE_EXTENSIONS,
  FORBIDDEN_PATH_PATTERNS: () => FORBIDDEN_PATH_PATTERNS,
  HASH_SEED_DJB2: () => HASH_SEED_DJB2,
  HASH_SEED_FNV1A: () => HASH_SEED_FNV1A,
  HMR_CLIENT_RELOAD_DELAY_MS: () => HMR_CLIENT_RELOAD_DELAY_MS,
  HMR_CLOSE_MESSAGE_TOO_LARGE: () => HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_NORMAL: () => HMR_CLOSE_NORMAL,
  HMR_CLOSE_RATE_LIMIT: () => HMR_CLOSE_RATE_LIMIT,
  HMR_FILE_WATCHER_DEBOUNCE_MS: () => HMR_FILE_WATCHER_DEBOUNCE_MS,
  HMR_KEEP_ALIVE_INTERVAL_MS: () => HMR_KEEP_ALIVE_INTERVAL_MS,
  HMR_MAX_MESSAGES_PER_MINUTE: () => HMR_MAX_MESSAGES_PER_MINUTE,
  HMR_MAX_MESSAGE_SIZE_BYTES: () => HMR_MAX_MESSAGE_SIZE_BYTES,
  HMR_MESSAGE_TYPES: () => HMR_MESSAGE_TYPES,
  HMR_PORT_OFFSET: () => HMR_PORT_OFFSET,
  HMR_RATE_LIMIT_WINDOW_MS: () => HMR_RATE_LIMIT_WINDOW_MS,
  HMR_RECONNECT_DELAY_MS: () => HMR_RECONNECT_DELAY_MS,
  HMR_RELOAD_DELAY_MS: () => HMR_RELOAD_DELAY_MS,
  HOURS_PER_DAY: () => HOURS_PER_DAY,
  HTTP_BAD_GATEWAY: () => HTTP_BAD_GATEWAY,
  HTTP_BAD_REQUEST: () => HTTP_BAD_REQUEST,
  HTTP_CACHE_LONG_MAX_AGE_SEC: () => HTTP_CACHE_LONG_MAX_AGE_SEC,
  HTTP_CACHE_MEDIUM_MAX_AGE_SEC: () => HTTP_CACHE_MEDIUM_MAX_AGE_SEC,
  HTTP_CACHE_SHORT_MAX_AGE_SEC: () => HTTP_CACHE_SHORT_MAX_AGE_SEC,
  HTTP_CONTENT_TYPES: () => HTTP_CONTENT_TYPES,
  HTTP_CONTENT_TYPE_IMAGE_AVIF: () => HTTP_CONTENT_TYPE_IMAGE_AVIF,
  HTTP_CONTENT_TYPE_IMAGE_GIF: () => HTTP_CONTENT_TYPE_IMAGE_GIF,
  HTTP_CONTENT_TYPE_IMAGE_ICO: () => HTTP_CONTENT_TYPE_IMAGE_ICO,
  HTTP_CONTENT_TYPE_IMAGE_JPEG: () => HTTP_CONTENT_TYPE_IMAGE_JPEG,
  HTTP_CONTENT_TYPE_IMAGE_PNG: () => HTTP_CONTENT_TYPE_IMAGE_PNG,
  HTTP_CONTENT_TYPE_IMAGE_SVG: () => HTTP_CONTENT_TYPE_IMAGE_SVG,
  HTTP_CONTENT_TYPE_IMAGE_WEBP: () => HTTP_CONTENT_TYPE_IMAGE_WEBP,
  HTTP_CREATED: () => HTTP_CREATED,
  HTTP_FORBIDDEN: () => HTTP_FORBIDDEN,
  HTTP_GONE: () => HTTP_GONE,
  HTTP_INTERNAL_SERVER_ERROR: () => HTTP_INTERNAL_SERVER_ERROR,
  HTTP_METHOD_NOT_ALLOWED: () => HTTP_METHOD_NOT_ALLOWED,
  HTTP_MODULE_FETCH_TIMEOUT_MS: () => HTTP_MODULE_FETCH_TIMEOUT_MS,
  HTTP_NETWORK_CONNECT_TIMEOUT: () => HTTP_NETWORK_CONNECT_TIMEOUT,
  HTTP_NOT_FOUND: () => HTTP_NOT_FOUND,
  HTTP_NOT_IMPLEMENTED: () => HTTP_NOT_IMPLEMENTED,
  HTTP_NOT_MODIFIED: () => HTTP_NOT_MODIFIED,
  HTTP_NO_CONTENT: () => HTTP_NO_CONTENT,
  HTTP_OK: () => HTTP_OK,
  HTTP_PAYLOAD_TOO_LARGE: () => HTTP_PAYLOAD_TOO_LARGE,
  HTTP_REDIRECT_FOUND: () => HTTP_REDIRECT_FOUND,
  HTTP_REQUEST_HEADER_FIELDS_TOO_LARGE: () => HTTP_REQUEST_HEADER_FIELDS_TOO_LARGE,
  HTTP_SERVER_ERROR: () => HTTP_SERVER_ERROR,
  HTTP_STATUS_CLIENT_ERROR_MIN: () => HTTP_STATUS_CLIENT_ERROR_MIN,
  HTTP_STATUS_REDIRECT_MIN: () => HTTP_STATUS_REDIRECT_MIN,
  HTTP_STATUS_SERVER_ERROR_MIN: () => HTTP_STATUS_SERVER_ERROR_MIN,
  HTTP_STATUS_SUCCESS_MIN: () => HTTP_STATUS_SUCCESS_MIN,
  HTTP_TOO_MANY_REQUESTS: () => HTTP_TOO_MANY_REQUESTS,
  HTTP_UNAUTHORIZED: () => HTTP_UNAUTHORIZED,
  HTTP_UNAVAILABLE: () => HTTP_UNAVAILABLE,
  HTTP_URI_TOO_LONG: () => HTTP_URI_TOO_LONG,
  IMAGE_OPTIMIZATION: () => IMAGE_OPTIMIZATION,
  InMemoryBundleManifestStore: () => InMemoryBundleManifestStore,
  JSDELIVR_CDN_BASE: () => JSDELIVR_CDN_BASE,
  KB_IN_BYTES: () => KB_IN_BYTES,
  LRU_DEFAULT_MAX_ENTRIES: () => LRU_DEFAULT_MAX_ENTRIES,
  LRU_DEFAULT_MAX_SIZE_BYTES: () => LRU_DEFAULT_MAX_SIZE_BYTES,
  LogLevel: () => LogLevel,
  MAX_CHUNK_SIZE_KB: () => MAX_CHUNK_SIZE_KB,
  MAX_PATH_LENGTH: () => MAX_PATH_LENGTH,
  MAX_PATH_TRAVERSAL_DEPTH: () => MAX_PATH_TRAVERSAL_DEPTH,
  MAX_PORT: () => MAX_PORT,
  MDX_CACHE_TTL_DEVELOPMENT_MS: () => MDX_CACHE_TTL_DEVELOPMENT_MS,
  MDX_CACHE_TTL_PRODUCTION_MS: () => MDX_CACHE_TTL_PRODUCTION_MS,
  MDX_RENDERER_MAX_ENTRIES: () => MDX_RENDERER_MAX_ENTRIES,
  MDX_RENDERER_TTL_MS: () => MDX_RENDERER_TTL_MS,
  MINUTES_PER_HOUR: () => MINUTES_PER_HOUR,
  MIN_PORT: () => MIN_PORT,
  MS_PER_MINUTE: () => MS_PER_MINUTE,
  MS_PER_SECOND: () => MS_PER_SECOND,
  MemoCache: () => MemoCache,
  ONE_DAY_MS: () => ONE_DAY_MS,
  PATHS: () => PATHS,
  PREFETCH_DEFAULT_DELAY_MS: () => PREFETCH_DEFAULT_DELAY_MS,
  PREFETCH_DEFAULT_TIMEOUT_MS: () => PREFETCH_DEFAULT_TIMEOUT_MS,
  PREFETCH_MAX_SIZE_BYTES: () => PREFETCH_MAX_SIZE_BYTES,
  PROSE_MAX_WIDTH: () => PROSE_MAX_WIDTH,
  REACT_DEFAULT_VERSION: () => REACT_DEFAULT_VERSION,
  REACT_VERSION_17: () => REACT_VERSION_17,
  REACT_VERSION_18_2: () => REACT_VERSION_18_2,
  REACT_VERSION_18_3: () => REACT_VERSION_18_3,
  REACT_VERSION_19: () => REACT_VERSION_19,
  REACT_VERSION_19_RC: () => REACT_VERSION_19_RC,
  RENDERER_CORE_MAX_ENTRIES: () => RENDERER_CORE_MAX_ENTRIES,
  RENDERER_CORE_TTL_MS: () => RENDERER_CORE_TTL_MS,
  RESPONSIVE_IMAGE_WIDTHS: () => RESPONSIVE_IMAGE_WIDTHS,
  RESPONSIVE_IMAGE_WIDTH_LG: () => RESPONSIVE_IMAGE_WIDTH_LG,
  RESPONSIVE_IMAGE_WIDTH_MD: () => RESPONSIVE_IMAGE_WIDTH_MD,
  RESPONSIVE_IMAGE_WIDTH_SM: () => RESPONSIVE_IMAGE_WIDTH_SM,
  RESPONSIVE_IMAGE_WIDTH_XS: () => RESPONSIVE_IMAGE_WIDTH_XS,
  RSC_MANIFEST_CACHE_TTL_MS: () => RSC_MANIFEST_CACHE_TTL_MS,
  SECONDS_PER_MINUTE: () => SECONDS_PER_MINUTE,
  SERVER_ACTION_DEFAULT_TTL_SEC: () => SERVER_ACTION_DEFAULT_TTL_SEC,
  SERVER_FUNCTION_DEFAULT_TIMEOUT_MS: () => SERVER_FUNCTION_DEFAULT_TIMEOUT_MS,
  TSX_LAYOUT_MAX_ENTRIES: () => TSX_LAYOUT_MAX_ENTRIES,
  TSX_LAYOUT_TTL_MS: () => TSX_LAYOUT_TTL_MS,
  UNOCSS_VERSION: () => UNOCSS_VERSION,
  VERSION: () => VERSION,
  VERYFRONT_PATHS: () => VERYFRONT_PATHS,
  Z_INDEX_DEV_INDICATOR: () => Z_INDEX_DEV_INDICATOR,
  Z_INDEX_ERROR_OVERLAY: () => Z_INDEX_ERROR_OVERLAY,
  __loggerResetForTests: () => __loggerResetForTests,
  agentLogger: () => agentLogger,
  bundlerLogger: () => bundlerLogger,
  cliLogger: () => cliLogger,
  computeCodeHash: () => computeCodeHash,
  computeContentHash: () => computeContentHash,
  computeHash: () => computeHash,
  estimateSize: () => estimateSize,
  estimateSizeWithCircularHandling: () => estimateSizeWithCircularHandling,
  formatBytes: () => formatBytes,
  formatDuration: () => formatDuration,
  formatNumber: () => formatNumber,
  fromBase64Url: () => fromBase64Url,
  getBundleManifestStore: () => getBundleManifestStore,
  getBundleManifestTTL: () => getBundleManifestTTL,
  getContentHash: () => getContentHash,
  getDenoStdNodeBase: () => getDenoStdNodeBase,
  getDirectory: () => getDirectory,
  getEnvironmentVariable: () => getEnvironmentVariable,
  getExtension: () => getExtension,
  getReactCDNUrl: () => getReactCDNUrl,
  getReactDOMCDNUrl: () => getReactDOMCDNUrl,
  getReactDOMClientCDNUrl: () => getReactDOMClientCDNUrl,
  getReactDOMServerCDNUrl: () => getReactDOMServerCDNUrl,
  getReactImportMap: () => getReactImportMap,
  getReactJSXDevRuntimeCDNUrl: () => getReactJSXDevRuntimeCDNUrl,
  getReactJSXRuntimeCDNUrl: () => getReactJSXRuntimeCDNUrl,
  getUnoCSSTailwindResetUrl: () => getUnoCSSTailwindResetUrl,
  hasBunRuntime: () => hasBunRuntime,
  hasDenoRuntime: () => hasDenoRuntime,
  hasHashedFilename: () => hasHashedFilename,
  hasNodeProcess: () => hasNodeProcess,
  initializeBundleManifest: () => initializeBundleManifest,
  isAbsolutePath: () => isAbsolutePath,
  isCompiledBinary: () => isCompiledBinary,
  isDevelopmentEnvironment: () => isDevelopmentEnvironment,
  isProductionEnvironment: () => isProductionEnvironment,
  isRSCEnabled: () => isRSCEnabled,
  isTestEnvironment: () => isTestEnvironment,
  isValidHMRMessageType: () => isValidHMRMessageType,
  isWithinDirectory: () => isWithinDirectory,
  joinPath: () => joinPath,
  logger: () => logger,
  memoize: () => memoize,
  memoizeAsync: () => memoizeAsync,
  memoizeHash: () => simpleHash2,
  normalizePath: () => normalizePath,
  numericHash: () => simpleHash,
  rendererLogger: () => rendererLogger,
  serverLogger: () => serverLogger,
  setBundleManifestStore: () => setBundleManifestStore,
  shortHash: () => shortHash,
  simpleHash: () => simpleHash,
  toBase64Url: () => toBase64Url,
  truncateString: () => truncateString,
  warmupBundleManifest: () => warmupBundleManifest
});
var init_utils = __esm({
  "src/core/utils/index.ts"() {
    init_runtime_guards();
    init_logger2();
    init_constants();
    init_version();
    init_paths();
    init_hash_utils();
    init_memoize();
    init_path_utils();
    init_format_utils();
    init_bundle_manifest();
    init_bundle_manifest_init();
    init_feature_flags();
    init_platform();
  }
});

// src/core/errors/veryfront-error.ts
function createError(error2) {
  return error2;
}
function toError(veryfrontError) {
  const error2 = new Error(veryfrontError.message);
  error2.name = \`VeryfrontError[\${veryfrontError.type}]\`;
  Object.defineProperty(error2, "context", {
    value: veryfrontError,
    enumerable: false,
    configurable: true
  });
  return error2;
}
var init_veryfront_error = __esm({
  "src/core/errors/veryfront-error.ts"() {
    "use strict";
  }
});

// src/core/config/schema.ts
import { z } from "zod";
var corsSchema, veryfrontConfigSchema;
var init_schema = __esm({
  "src/core/config/schema.ts"() {
    "use strict";
    init_veryfront_error();
    corsSchema = z.union([z.boolean(), z.object({ origin: z.string().optional() }).strict()]);
    veryfrontConfigSchema = z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      experimental: z.object({
        esmLayouts: z.boolean().optional(),
        precompileMDX: z.boolean().optional()
      }).partial().optional(),
      router: z.enum(["app", "pages"]).optional(),
      defaultLayout: z.string().optional(),
      theme: z.object({ colors: z.record(z.string()).optional() }).partial().optional(),
      build: z.object({
        outDir: z.string().optional(),
        trailingSlash: z.boolean().optional(),
        esbuild: z.object({
          wasmURL: z.string().url().optional(),
          worker: z.boolean().optional()
        }).partial().optional()
      }).partial().optional(),
      cache: z.object({
        dir: z.string().optional(),
        bundleManifest: z.object({
          type: z.enum(["redis", "kv", "memory"]).optional(),
          redisUrl: z.string().optional(),
          keyPrefix: z.string().optional(),
          ttl: z.number().int().positive().optional(),
          enabled: z.boolean().optional()
        }).partial().optional()
      }).partial().optional(),
      dev: z.object({
        port: z.number().int().positive().optional(),
        host: z.string().optional(),
        open: z.boolean().optional(),
        hmr: z.boolean().optional(),
        components: z.array(z.string()).optional()
      }).partial().optional(),
      resolve: z.object({
        importMap: z.object({
          imports: z.record(z.string()).optional(),
          scopes: z.record(z.record(z.string())).optional()
        }).partial().optional()
      }).partial().optional(),
      security: z.object({
        csp: z.record(z.array(z.string())).optional(),
        remoteHosts: z.array(z.string().url()).optional(),
        cors: corsSchema.optional(),
        coop: z.enum(["same-origin", "same-origin-allow-popups", "unsafe-none"]).optional(),
        corp: z.enum(["same-origin", "same-site", "cross-origin"]).optional(),
        coep: z.enum(["require-corp", "unsafe-none"]).optional()
      }).partial().optional(),
      middleware: z.object({
        custom: z.array(z.function()).optional()
      }).partial().optional(),
      theming: z.object({
        brandName: z.string().optional(),
        logoHtml: z.string().optional()
      }).partial().optional(),
      assetPipeline: z.object({
        images: z.object({
          enabled: z.boolean().optional(),
          formats: z.array(z.enum(["webp", "avif", "jpeg", "png"])).optional(),
          sizes: z.array(z.number().int().positive()).optional(),
          quality: z.number().int().min(1).max(100).optional(),
          inputDir: z.string().optional(),
          outputDir: z.string().optional(),
          preserveOriginal: z.boolean().optional()
        }).partial().optional(),
        css: z.object({
          enabled: z.boolean().optional(),
          minify: z.boolean().optional(),
          autoprefixer: z.boolean().optional(),
          purge: z.boolean().optional(),
          criticalCSS: z.boolean().optional(),
          inputDir: z.string().optional(),
          outputDir: z.string().optional(),
          browsers: z.array(z.string()).optional(),
          purgeContent: z.array(z.string()).optional(),
          sourceMap: z.boolean().optional()
        }).partial().optional()
      }).partial().optional(),
      observability: z.object({
        tracing: z.object({
          enabled: z.boolean().optional(),
          exporter: z.enum(["jaeger", "zipkin", "otlp", "console"]).optional(),
          endpoint: z.string().optional(),
          serviceName: z.string().optional(),
          sampleRate: z.number().min(0).max(1).optional()
        }).partial().optional(),
        metrics: z.object({
          enabled: z.boolean().optional(),
          exporter: z.enum(["prometheus", "otlp", "console"]).optional(),
          endpoint: z.string().optional(),
          prefix: z.string().optional(),
          collectInterval: z.number().int().positive().optional()
        }).partial().optional()
      }).partial().optional(),
      fs: z.object({
        type: z.enum(["local", "veryfront-api", "memory"]).optional(),
        local: z.object({
          baseDir: z.string().optional()
        }).partial().optional(),
        veryfront: z.object({
          apiBaseUrl: z.string().url(),
          apiToken: z.string(),
          projectSlug: z.string(),
          cache: z.object({
            enabled: z.boolean().optional(),
            ttl: z.number().int().positive().optional(),
            maxSize: z.number().int().positive().optional()
          }).partial().optional(),
          retry: z.object({
            maxRetries: z.number().int().min(0).optional(),
            initialDelay: z.number().int().positive().optional(),
            maxDelay: z.number().int().positive().optional()
          }).partial().optional()
        }).partial().optional(),
        memory: z.object({
          files: z.record(z.union([z.string(), z.instanceof(Uint8Array)])).optional()
        }).partial().optional()
      }).partial().optional()
    }).partial();
  }
});

// src/_shims/std-path.ts
import * as nodeUrl from "node:url";
import * as nodePath from "node:path";
var init_std_path = __esm({
  "src/_shims/std-path.ts"() {
  }
});

// src/core/config/loader.ts
function getDefaultImportMapForConfig() {
  return { imports: getReactImportMap(REACT_DEFAULT_VERSION) };
}
var DEFAULT_CONFIG;
var init_loader = __esm({
  "src/core/config/loader.ts"() {
    "use strict";
    init_schema();
    init_std_path();
    init_logger();
    init_cdn();
    DEFAULT_CONFIG = {
      title: "Veryfront App",
      description: "Built with Veryfront",
      experimental: {
        esmLayouts: true
      },
      router: void 0,
      defaultLayout: void 0,
      theme: {
        colors: {
          primary: "#3B82F6"
        }
      },
      build: {
        outDir: "dist",
        trailingSlash: false,
        esbuild: {
          wasmURL: "https://deno.land/x/esbuild@v0.20.1/esbuild.wasm",
          worker: false
        }
      },
      cache: {
        dir: ".veryfront/cache",
        render: {
          type: "memory",
          ttl: void 0,
          maxEntries: 500,
          kvPath: void 0,
          redisUrl: void 0,
          redisKeyPrefix: void 0
        }
      },
      dev: {
        port: 3002,
        host: "localhost",
        open: false
      },
      resolve: {
        importMap: getDefaultImportMapForConfig()
      }
    };
  }
});

// src/core/config/define-config.ts
var init_define_config = __esm({
  "src/core/config/define-config.ts"() {
    "use strict";
    init_veryfront_error();
  }
});

// src/core/config/defaults.ts
var DEFAULT_DEV_PORT, DEFAULT_PREFETCH_DELAY_MS, DURATION_HISTOGRAM_BOUNDARIES_MS, SIZE_HISTOGRAM_BOUNDARIES_KB, PAGE_TRANSITION_DELAY_MS;
var init_defaults = __esm({
  "src/core/config/defaults.ts"() {
    "use strict";
    DEFAULT_DEV_PORT = 3e3;
    DEFAULT_PREFETCH_DELAY_MS = 100;
    DURATION_HISTOGRAM_BOUNDARIES_MS = [
      5,
      10,
      25,
      50,
      75,
      100,
      250,
      500,
      750,
      1e3,
      2500,
      5e3,
      7500,
      1e4
    ];
    SIZE_HISTOGRAM_BOUNDARIES_KB = [
      1,
      5,
      10,
      25,
      50,
      100,
      250,
      500,
      1e3,
      2500,
      5e3,
      1e4
    ];
    PAGE_TRANSITION_DELAY_MS = 150;
  }
});

// src/core/config/network-defaults.ts
var init_network_defaults = __esm({
  "src/core/config/network-defaults.ts"() {
    "use strict";
  }
});

// src/core/config/index.ts
var init_config = __esm({
  "src/core/config/index.ts"() {
    init_loader();
    init_define_config();
    init_schema();
    init_defaults();
    init_network_defaults();
  }
});

// src/core/errors/types.ts
var VeryfrontError;
var init_types = __esm({
  "src/core/errors/types.ts"() {
    "use strict";
    VeryfrontError = class extends Error {
      constructor(message, code, context) {
        super(message);
        this.name = "VeryfrontError";
        this.code = code;
        this.context = context;
      }
    };
  }
});

// src/core/errors/agent-errors.ts
var init_agent_errors = __esm({
  "src/core/errors/agent-errors.ts"() {
    "use strict";
    init_types();
  }
});

// src/core/errors/build-errors.ts
var init_build_errors = __esm({
  "src/core/errors/build-errors.ts"() {
    "use strict";
    init_types();
  }
});

// src/core/errors/runtime-errors.ts
var init_runtime_errors = __esm({
  "src/core/errors/runtime-errors.ts"() {
    "use strict";
    init_types();
  }
});

// src/core/errors/system-errors.ts
var NetworkError;
var init_system_errors = __esm({
  "src/core/errors/system-errors.ts"() {
    "use strict";
    init_types();
    NetworkError = class extends VeryfrontError {
      constructor(message, context) {
        super(message, "NETWORK_ERROR" /* NETWORK_ERROR */, context);
        this.name = "NetworkError";
      }
    };
  }
});

// src/core/errors/error-handlers.ts
var init_error_handlers = __esm({
  "src/core/errors/error-handlers.ts"() {
    "use strict";
    init_logger();
    init_types();
  }
});

// src/core/errors/error-codes.ts
function getErrorDocsUrl(code) {
  return \`https://veryfront.com/docs/errors/\${code}\`;
}
var ErrorCode2;
var init_error_codes = __esm({
  "src/core/errors/error-codes.ts"() {
    "use strict";
    ErrorCode2 = {
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
      TIMEOUT_ERROR: "VF904"
    };
  }
});

// src/core/errors/catalog/factory.ts
function createErrorSolution(code, config) {
  return {
    code,
    ...config,
    docs: config.docs ?? getErrorDocsUrl(code)
  };
}
function createSimpleError(code, title, message, steps) {
  return createErrorSolution(code, { title, message, steps });
}
var init_factory = __esm({
  "src/core/errors/catalog/factory.ts"() {
    "use strict";
    init_error_codes();
  }
});

// src/core/errors/catalog/config-errors.ts
var CONFIG_ERROR_CATALOG;
var init_config_errors = __esm({
  "src/core/errors/catalog/config-errors.ts"() {
    "use strict";
    init_error_codes();
    init_factory();
    CONFIG_ERROR_CATALOG = {
      [ErrorCode2.CONFIG_NOT_FOUND]: createErrorSolution(ErrorCode2.CONFIG_NOT_FOUND, {
        title: "Configuration file not found",
        message: "Veryfront could not find veryfront.config.js in your project root.",
        steps: [
          "Create veryfront.config.js in your project root directory",
          "Run 'veryfront init' to generate a default configuration",
          "Or copy from an example project"
        ],
        example: \`// veryfront.config.js
export default {
  title: "My App",
  dev: { port: 3002 }
}\`,
        tips: ["You can use .ts or .mjs extensions too", "Config is optional for simple projects"]
      }),
      [ErrorCode2.CONFIG_INVALID]: createErrorSolution(ErrorCode2.CONFIG_INVALID, {
        title: "Invalid configuration",
        message: "Your configuration file has invalid values or structure.",
        steps: [
          "Check that the config exports a default object",
          "Ensure all values are valid JavaScript types",
          "Remove any trailing commas",
          "Verify property names match the schema"
        ],
        example: \`// \\u2713 Valid config
export default {
  title: "My App",
  dev: {
    port: 3002,
    open: true
  }
}\`
      }),
      [ErrorCode2.CONFIG_PARSE_ERROR]: createSimpleError(
        ErrorCode2.CONFIG_PARSE_ERROR,
        "Configuration parse error",
        "Failed to parse your configuration file.",
        [
          "Check for syntax errors (missing brackets, quotes, etc.)",
          "Ensure the file has valid JavaScript/TypeScript syntax",
          "Look for the specific parse error in the output above"
        ]
      ),
      [ErrorCode2.CONFIG_VALIDATION_ERROR]: createSimpleError(
        ErrorCode2.CONFIG_VALIDATION_ERROR,
        "Configuration validation failed",
        "Configuration values do not pass validation.",
        [
          "Check that port numbers are between 1-65535",
          "Ensure boolean flags are true/false (not strings)",
          "Verify URLs are properly formatted",
          "Check array/object structures match expected format"
        ]
      ),
      [ErrorCode2.CONFIG_TYPE_ERROR]: createSimpleError(
        ErrorCode2.CONFIG_TYPE_ERROR,
        "Configuration type error",
        "A configuration value has the wrong type.",
        [
          "Check that numbers are not in quotes",
          'Ensure booleans are true/false, not "true"/"false"',
          "Verify arrays use [] brackets",
          "Check objects use {} braces"
        ]
      ),
      [ErrorCode2.IMPORT_MAP_INVALID]: createErrorSolution(ErrorCode2.IMPORT_MAP_INVALID, {
        title: "Invalid import map",
        message: "The import map in your configuration is invalid.",
        steps: [
          "Check import map structure: { imports: {}, scopes: {} }",
          "Ensure URLs are valid and accessible",
          "Verify package names are correct"
        ],
        example: \`resolve: {
  importMap: {
    imports: {
      "react": "https://esm.sh/react@19",
      "@/utils": "./src/utils/index.ts"
    }
  }
}\`
      }),
      [ErrorCode2.CORS_CONFIG_INVALID]: createErrorSolution(ErrorCode2.CORS_CONFIG_INVALID, {
        title: "Invalid CORS configuration",
        message: "The CORS configuration is invalid.",
        steps: [
          "Use true for default CORS settings",
          "Or provide an object with origin, methods, headers",
          "Ensure origin is a string, not an array"
        ],
        example: \`security: {
  cors: true  // or { origin: "https://example.com" }
}\`
      })
    };
  }
});

// src/core/errors/catalog/build-errors.ts
var BUILD_ERROR_CATALOG;
var init_build_errors2 = __esm({
  "src/core/errors/catalog/build-errors.ts"() {
    "use strict";
    init_error_codes();
    init_factory();
    BUILD_ERROR_CATALOG = {
      [ErrorCode2.BUILD_FAILED]: createErrorSolution(ErrorCode2.BUILD_FAILED, {
        title: "Build failed",
        message: "The build process encountered errors.",
        steps: [
          "Check the error messages above for specific issues",
          "Fix any TypeScript or syntax errors",
          "Ensure all imports can be resolved",
          "Run 'veryfront doctor' to check your environment"
        ],
        tips: ["Try running with --verbose for more details", "Check build logs for warnings"]
      }),
      [ErrorCode2.BUNDLE_ERROR]: createSimpleError(
        ErrorCode2.BUNDLE_ERROR,
        "Bundle generation failed",
        "Failed to generate JavaScript bundles.",
        [
          "Check for circular dependencies",
          "Ensure all imports are valid",
          "Try clearing cache: veryfront clean"
        ]
      ),
      [ErrorCode2.TYPESCRIPT_ERROR]: createSimpleError(
        ErrorCode2.TYPESCRIPT_ERROR,
        "TypeScript compilation error",
        "TypeScript found errors in your code.",
        [
          "Fix the TypeScript errors shown above",
          "Check your tsconfig.json configuration",
          "Ensure all types are properly imported"
        ]
      ),
      [ErrorCode2.MDX_COMPILE_ERROR]: createErrorSolution(ErrorCode2.MDX_COMPILE_ERROR, {
        title: "MDX compilation failed",
        message: "Failed to compile MDX file.",
        steps: [
          "Check for syntax errors in your MDX file",
          "Ensure frontmatter YAML is valid",
          "Verify JSX components are properly imported",
          "Check for unclosed tags or brackets"
        ],
        example: \`---
title: My Post
---

import Button from './components/Button.jsx'

# Hello World

<Button>Click me</Button>\`
      }),
      [ErrorCode2.ASSET_OPTIMIZATION_ERROR]: createSimpleError(
        ErrorCode2.ASSET_OPTIMIZATION_ERROR,
        "Asset optimization failed",
        "Failed to optimize assets (images, CSS, etc.).",
        [
          "Check that asset files are valid",
          "Ensure file paths are correct",
          "Try disabling optimization temporarily"
        ]
      ),
      [ErrorCode2.SSG_GENERATION_ERROR]: createSimpleError(
        ErrorCode2.SSG_GENERATION_ERROR,
        "Static site generation failed",
        "Failed to generate static pages.",
        [
          "Check that all routes are valid",
          "Ensure getStaticData functions return correctly",
          "Verify no dynamic content requires runtime"
        ]
      ),
      [ErrorCode2.SOURCEMAP_ERROR]: createSimpleError(
        ErrorCode2.SOURCEMAP_ERROR,
        "Source map generation failed",
        "Failed to generate source maps.",
        [
          "Try disabling source maps temporarily",
          "Check for very large files that might cause issues"
        ]
      )
    };
  }
});

// src/core/errors/catalog/runtime-errors.ts
var RUNTIME_ERROR_CATALOG;
var init_runtime_errors2 = __esm({
  "src/core/errors/catalog/runtime-errors.ts"() {
    "use strict";
    init_error_codes();
    init_factory();
    RUNTIME_ERROR_CATALOG = {
      [ErrorCode2.HYDRATION_MISMATCH]: createErrorSolution(ErrorCode2.HYDRATION_MISMATCH, {
        title: "Hydration mismatch",
        message: "Client-side HTML does not match server-rendered HTML.",
        steps: [
          "Check for random values or timestamps in render",
          "Ensure Date() calls are consistent",
          "Avoid using browser-only APIs during SSR",
          "Check for white space or formatting differences"
        ],
        example: \`// \\u274C Wrong - random on each render
<div>{Math.random()}</div>

const [random, setRandom] = useState(0)
useEffect(() => setRandom(Math.random()), [])
<div>{random}</div>\`,
        relatedErrors: [ErrorCode2.RENDER_ERROR]
      }),
      [ErrorCode2.RENDER_ERROR]: createSimpleError(
        ErrorCode2.RENDER_ERROR,
        "Render error",
        "Failed to render component.",
        [
          "Check the component for errors",
          "Ensure all props are valid",
          "Look for null/undefined access",
          "Check error boundaries"
        ]
      ),
      [ErrorCode2.COMPONENT_ERROR]: createSimpleError(
        ErrorCode2.COMPONENT_ERROR,
        "Component error",
        "Error in component lifecycle or render.",
        [
          "Check component code for errors",
          "Ensure hooks follow Rules of Hooks",
          "Verify props are passed correctly"
        ]
      ),
      [ErrorCode2.LAYOUT_NOT_FOUND]: createErrorSolution(ErrorCode2.LAYOUT_NOT_FOUND, {
        title: "Layout file not found",
        message: "Required layout file is missing.",
        steps: [
          "Create app/layout.tsx in App Router",
          "Or create layouts/default.mdx for Pages Router",
          "Check file path and name are correct"
        ],
        example: \`// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}\`
      }),
      [ErrorCode2.PAGE_NOT_FOUND]: createSimpleError(
        ErrorCode2.PAGE_NOT_FOUND,
        "Page not found",
        "The requested page does not exist.",
        [
          "Check that the page file exists",
          "Verify file name matches route",
          "Ensure file extension is correct (.tsx, .jsx, .mdx)"
        ]
      ),
      [ErrorCode2.API_ERROR]: createSimpleError(
        ErrorCode2.API_ERROR,
        "API handler error",
        "Error in API route handler.",
        [
          "Check API handler code for errors",
          "Ensure proper error handling",
          "Verify request/response format"
        ]
      ),
      [ErrorCode2.MIDDLEWARE_ERROR]: createSimpleError(
        ErrorCode2.MIDDLEWARE_ERROR,
        "Middleware error",
        "Error in middleware execution.",
        [
          "Check middleware code for errors",
          "Ensure middleware returns Response",
          "Verify middleware is properly exported"
        ]
      )
    };
  }
});

// src/core/errors/catalog/route-errors.ts
var ROUTE_ERROR_CATALOG;
var init_route_errors = __esm({
  "src/core/errors/catalog/route-errors.ts"() {
    "use strict";
    init_error_codes();
    init_factory();
    ROUTE_ERROR_CATALOG = {
      [ErrorCode2.ROUTE_CONFLICT]: createSimpleError(
        ErrorCode2.ROUTE_CONFLICT,
        "Route conflict",
        "Multiple files are trying to handle the same route.",
        [
          "Check for duplicate route files",
          "Remove conflicting routes",
          "Use dynamic routes [id] carefully"
        ]
      ),
      [ErrorCode2.INVALID_ROUTE_FILE]: createErrorSolution(ErrorCode2.INVALID_ROUTE_FILE, {
        title: "Invalid route file",
        message: "Route file has invalid structure or exports.",
        steps: [
          "API routes must export GET, POST, etc. functions",
          "Page routes must export default component",
          "Check for syntax errors"
        ],
        example: \`// app/api/users/route.ts
export async function GET() {
  return Response.json({ users: [] })
}\`
      }),
      [ErrorCode2.ROUTE_HANDLER_INVALID]: createSimpleError(
        ErrorCode2.ROUTE_HANDLER_INVALID,
        "Invalid route handler",
        "Route handler does not return Response.",
        [
          "Ensure handler returns Response object",
          "Use Response.json() for JSON responses",
          "Check for missing return statement"
        ]
      ),
      [ErrorCode2.DYNAMIC_ROUTE_ERROR]: createSimpleError(
        ErrorCode2.DYNAMIC_ROUTE_ERROR,
        "Dynamic route error",
        "Error in dynamic route handling.",
        [
          "Check [param] syntax is correct",
          "Ensure params are accessed properly",
          "Verify dynamic segment names"
        ]
      ),
      [ErrorCode2.ROUTE_PARAMS_ERROR]: createSimpleError(
        ErrorCode2.ROUTE_PARAMS_ERROR,
        "Route parameters error",
        "Error accessing route parameters.",
        [
          "Check params object structure",
          "Ensure parameter names match route",
          "Verify params are strings"
        ]
      ),
      [ErrorCode2.API_ROUTE_ERROR]: createSimpleError(
        ErrorCode2.API_ROUTE_ERROR,
        "API route error",
        "Error in API route execution.",
        [
          "Check API handler code",
          "Ensure proper error handling",
          "Verify request parsing"
        ]
      )
    };
  }
});

// src/core/errors/catalog/module-errors.ts
var MODULE_ERROR_CATALOG;
var init_module_errors = __esm({
  "src/core/errors/catalog/module-errors.ts"() {
    "use strict";
    init_error_codes();
    init_factory();
    MODULE_ERROR_CATALOG = {
      [ErrorCode2.MODULE_NOT_FOUND]: createErrorSolution(ErrorCode2.MODULE_NOT_FOUND, {
        title: "Module not found",
        message: "Cannot find the imported module.",
        steps: [
          "Check that the file path is correct",
          "Ensure the module is installed or exists",
          "Add missing module to import map",
          "Check for typos in import statement"
        ],
        example: \`// Add to veryfront.config.js
resolve: {
  importMap: {
    imports: {
      "missing-lib": "https://esm.sh/missing-lib@1.0.0"
    }
  }
}\`
      }),
      [ErrorCode2.IMPORT_RESOLUTION_ERROR]: createSimpleError(
        ErrorCode2.IMPORT_RESOLUTION_ERROR,
        "Import resolution failed",
        "Failed to resolve import specifier.",
        [
          "Check import paths are correct",
          "Ensure modules are in import map",
          "Verify network connectivity for remote imports"
        ]
      ),
      [ErrorCode2.CIRCULAR_DEPENDENCY]: createSimpleError(
        ErrorCode2.CIRCULAR_DEPENDENCY,
        "Circular dependency detected",
        "Files are importing each other in a circle.",
        [
          "Identify the circular import chain",
          "Extract shared code to separate file",
          "Use dependency injection or lazy imports"
        ]
      ),
      [ErrorCode2.INVALID_IMPORT]: createSimpleError(
        ErrorCode2.INVALID_IMPORT,
        "Invalid import statement",
        "Import statement has invalid syntax.",
        [
          'Check import syntax: import X from "y"',
          "Ensure quotes are properly closed",
          "Verify export exists in target module"
        ]
      ),
      [ErrorCode2.DEPENDENCY_MISSING]: createErrorSolution(ErrorCode2.DEPENDENCY_MISSING, {
        title: "Required dependency not found",
        message: "A required dependency is missing.",
        steps: [
          "Add React to your import map",
          "Ensure all peer dependencies are included",
          "Run 'veryfront doctor' to verify setup"
        ],
        example: \`// Minimum required imports
resolve: {
  importMap: {
    imports: {
      "react": "https://esm.sh/react@19",
      "react-dom": "https://esm.sh/react-dom@19"
    }
  }
}\`
      }),
      [ErrorCode2.VERSION_MISMATCH]: createSimpleError(
        ErrorCode2.VERSION_MISMATCH,
        "Dependency version mismatch",
        "Incompatible versions of dependencies detected.",
        [
          "Ensure React and React-DOM versions match",
          "Check for multiple React instances",
          "Update dependencies to compatible versions"
        ]
      )
    };
  }
});

// src/core/errors/catalog/server-errors.ts
var SERVER_ERROR_CATALOG;
var init_server_errors = __esm({
  "src/core/errors/catalog/server-errors.ts"() {
    "use strict";
    init_error_codes();
    init_factory();
    SERVER_ERROR_CATALOG = {
      [ErrorCode2.PORT_IN_USE]: createErrorSolution(ErrorCode2.PORT_IN_USE, {
        title: "Port already in use",
        message: "Another process is using the specified port.",
        steps: [
          "Stop the other process: lsof -i :PORT",
          "Use a different port: veryfront dev --port 3003",
          "Add port to config file"
        ],
        example: \`// veryfront.config.js
dev: {
  port: 3003
}\`
      }),
      [ErrorCode2.SERVER_START_ERROR]: createSimpleError(
        ErrorCode2.SERVER_START_ERROR,
        "Server failed to start",
        "Development server could not start.",
        [
          "Check for port conflicts",
          "Ensure file permissions are correct",
          "Verify configuration is valid"
        ]
      ),
      [ErrorCode2.HMR_ERROR]: createSimpleError(
        ErrorCode2.HMR_ERROR,
        "Hot Module Replacement error",
        "HMR failed to update module.",
        [
          "Try refreshing the page",
          "Check for syntax errors",
          "Restart dev server if persistent"
        ]
      ),
      [ErrorCode2.CACHE_ERROR]: createSimpleError(
        ErrorCode2.CACHE_ERROR,
        "Cache operation failed",
        "Error reading or writing cache.",
        [
          "Clear cache: veryfront clean --cache",
          "Check disk space",
          "Verify file permissions"
        ]
      ),
      [ErrorCode2.FILE_WATCH_ERROR]: createSimpleError(
        ErrorCode2.FILE_WATCH_ERROR,
        "File watching failed",
        "Could not watch files for changes.",
        [
          "Check system file watch limits",
          "Reduce number of watched files",
          "Try restarting dev server"
        ]
      ),
      [ErrorCode2.REQUEST_ERROR]: createSimpleError(
        ErrorCode2.REQUEST_ERROR,
        "Request handling error",
        "Error processing HTTP request.",
        [
          "Check request format and headers",
          "Verify route handler code",
          "Check for middleware errors"
        ]
      )
    };
  }
});

// src/core/errors/catalog/rsc-errors.ts
var RSC_ERROR_CATALOG;
var init_rsc_errors = __esm({
  "src/core/errors/catalog/rsc-errors.ts"() {
    "use strict";
    init_error_codes();
    init_factory();
    RSC_ERROR_CATALOG = {
      [ErrorCode2.CLIENT_BOUNDARY_VIOLATION]: createErrorSolution(
        ErrorCode2.CLIENT_BOUNDARY_VIOLATION,
        {
          title: "Client/Server boundary violation",
          message: "Server-only code used in Client Component.",
          steps: [
            "Move server-only imports to Server Components",
            "Use 'use server' for server actions",
            "Split component into server and client parts"
          ],
          example: \`// \\u2713 Correct pattern
import { db } from './database'
export default async function ServerComponent() {
  const data = await db.query('...')
  return <ClientComponent data={data} />
}

'use client'
export default function ClientComponent({ data }) {
  return <div>{data}</div>
}\`
        }
      ),
      [ErrorCode2.SERVER_ONLY_IN_CLIENT]: createSimpleError(
        ErrorCode2.SERVER_ONLY_IN_CLIENT,
        "Server-only module in Client Component",
        "Cannot use server-only module in client code.",
        [
          "Move server logic to Server Component",
          "Use API routes for client data fetching",
          "Pass data as props from server"
        ]
      ),
      [ErrorCode2.CLIENT_ONLY_IN_SERVER]: createSimpleError(
        ErrorCode2.CLIENT_ONLY_IN_SERVER,
        "Client-only code in Server Component",
        "Cannot use browser APIs in Server Component.",
        [
          "Add 'use client' directive",
          "Move client-only code to Client Component",
          "Use useEffect for client-side logic"
        ]
      ),
      [ErrorCode2.INVALID_USE_CLIENT]: createErrorSolution(ErrorCode2.INVALID_USE_CLIENT, {
        title: "Invalid 'use client' directive",
        message: "'use client' directive is not properly placed.",
        steps: [
          "Place 'use client' at the very top of file",
          "Must be before any imports",
          'Use exact string: "use client"'
        ],
        example: \`'use client'  // Must be first line

import React from 'react'\`
      }),
      [ErrorCode2.INVALID_USE_SERVER]: createSimpleError(
        ErrorCode2.INVALID_USE_SERVER,
        "Invalid 'use server' directive",
        "'use server' directive is not properly placed.",
        [
          "Place 'use server' at top of function",
          "Or at top of file for all functions",
          'Use exact string: "use server"'
        ]
      ),
      [ErrorCode2.RSC_PAYLOAD_ERROR]: createSimpleError(
        ErrorCode2.RSC_PAYLOAD_ERROR,
        "RSC payload error",
        "Error serializing Server Component payload.",
        [
          "Ensure props are JSON-serializable",
          "Avoid passing functions as props",
          "Check for circular references"
        ]
      )
    };
  }
});

// src/core/errors/catalog/dev-errors.ts
var DEV_ERROR_CATALOG;
var init_dev_errors = __esm({
  "src/core/errors/catalog/dev-errors.ts"() {
    "use strict";
    init_error_codes();
    init_factory();
    DEV_ERROR_CATALOG = {
      [ErrorCode2.DEV_SERVER_ERROR]: createSimpleError(
        ErrorCode2.DEV_SERVER_ERROR,
        "Development server error",
        "Error in development server.",
        [
          "Check server logs for details",
          "Try restarting dev server",
          "Clear cache and restart"
        ]
      ),
      [ErrorCode2.FAST_REFRESH_ERROR]: createSimpleError(
        ErrorCode2.FAST_REFRESH_ERROR,
        "Fast Refresh error",
        "React Fast Refresh failed.",
        [
          "Check for syntax errors",
          "Ensure components follow Fast Refresh rules",
          "Try full page refresh"
        ]
      ),
      [ErrorCode2.ERROR_OVERLAY_ERROR]: createSimpleError(
        ErrorCode2.ERROR_OVERLAY_ERROR,
        "Error overlay failed",
        "Could not display error overlay.",
        [
          "Check browser console for details",
          "Try disabling browser extensions",
          "Refresh the page"
        ]
      ),
      [ErrorCode2.SOURCE_MAP_ERROR]: createSimpleError(
        ErrorCode2.SOURCE_MAP_ERROR,
        "Source map error",
        "Error loading or parsing source map.",
        [
          "Check that source maps are enabled",
          "Try rebuilding the project",
          "Check for corrupted build files"
        ]
      )
    };
  }
});

// src/core/errors/catalog/deployment-errors.ts
var DEPLOYMENT_ERROR_CATALOG;
var init_deployment_errors = __esm({
  "src/core/errors/catalog/deployment-errors.ts"() {
    "use strict";
    init_error_codes();
    init_factory();
    DEPLOYMENT_ERROR_CATALOG = {
      [ErrorCode2.DEPLOYMENT_ERROR]: createSimpleError(
        ErrorCode2.DEPLOYMENT_ERROR,
        "Deployment failed",
        "Failed to deploy application.",
        [
          "Check deployment logs for details",
          "Verify platform credentials",
          "Ensure build succeeded first"
        ]
      ),
      [ErrorCode2.PLATFORM_ERROR]: createSimpleError(
        ErrorCode2.PLATFORM_ERROR,
        "Platform error",
        "Deployment platform returned an error.",
        [
          "Check platform status page",
          "Verify API keys and credentials",
          "Try deploying again"
        ]
      ),
      [ErrorCode2.ENV_VAR_MISSING]: createSimpleError(
        ErrorCode2.ENV_VAR_MISSING,
        "Environment variable missing",
        "Required environment variable is not set.",
        [
          "Add variable to .env file",
          "Set variable in deployment platform",
          "Check variable name is correct"
        ]
      ),
      [ErrorCode2.PRODUCTION_BUILD_REQUIRED]: createSimpleError(
        ErrorCode2.PRODUCTION_BUILD_REQUIRED,
        "Production build required",
        "Must build project before deploying.",
        [
          "Run 'veryfront build' first",
          "Check that dist/ directory exists",
          "Verify build completed successfully"
        ]
      )
    };
  }
});

// src/core/errors/catalog/general-errors.ts
var GENERAL_ERROR_CATALOG;
var init_general_errors = __esm({
  "src/core/errors/catalog/general-errors.ts"() {
    "use strict";
    init_error_codes();
    init_factory();
    GENERAL_ERROR_CATALOG = {
      [ErrorCode2.UNKNOWN_ERROR]: createSimpleError(
        ErrorCode2.UNKNOWN_ERROR,
        "Unknown error",
        "An unexpected error occurred.",
        [
          "Check error details above",
          "Run 'veryfront doctor' to diagnose",
          "Try restarting the operation",
          "Check GitHub issues for similar problems"
        ]
      ),
      [ErrorCode2.PERMISSION_DENIED]: createSimpleError(
        ErrorCode2.PERMISSION_DENIED,
        "Permission denied",
        "Insufficient permissions to perform operation.",
        [
          "Check file/directory permissions",
          "Run with appropriate permissions",
          "Verify user has write access"
        ]
      ),
      [ErrorCode2.FILE_NOT_FOUND]: createSimpleError(
        ErrorCode2.FILE_NOT_FOUND,
        "File not found",
        "Required file does not exist.",
        [
          "Check that file path is correct",
          "Verify file exists in project",
          "Check for typos in file name"
        ]
      ),
      [ErrorCode2.INVALID_ARGUMENT]: createSimpleError(
        ErrorCode2.INVALID_ARGUMENT,
        "Invalid argument",
        "Command received invalid argument.",
        [
          "Check command syntax",
          "Verify argument values",
          "Run 'veryfront help <command>' for usage"
        ]
      ),
      [ErrorCode2.TIMEOUT_ERROR]: createSimpleError(
        ErrorCode2.TIMEOUT_ERROR,
        "Operation timed out",
        "Operation took too long to complete.",
        [
          "Check network connectivity",
          "Try increasing timeout if available",
          "Check for very large files"
        ]
      )
    };
  }
});

// src/core/errors/catalog/index.ts
var ERROR_CATALOG;
var init_catalog = __esm({
  "src/core/errors/catalog/index.ts"() {
    "use strict";
    init_config_errors();
    init_build_errors2();
    init_runtime_errors2();
    init_route_errors();
    init_module_errors();
    init_server_errors();
    init_rsc_errors();
    init_dev_errors();
    init_deployment_errors();
    init_general_errors();
    init_factory();
    ERROR_CATALOG = {
      ...CONFIG_ERROR_CATALOG,
      ...BUILD_ERROR_CATALOG,
      ...RUNTIME_ERROR_CATALOG,
      ...ROUTE_ERROR_CATALOG,
      ...MODULE_ERROR_CATALOG,
      ...SERVER_ERROR_CATALOG,
      ...RSC_ERROR_CATALOG,
      ...DEV_ERROR_CATALOG,
      ...DEPLOYMENT_ERROR_CATALOG,
      ...GENERAL_ERROR_CATALOG
    };
  }
});

// src/core/errors/user-friendly/error-catalog.ts
var init_error_catalog = __esm({
  "src/core/errors/user-friendly/error-catalog.ts"() {
    "use strict";
  }
});

// src/platform/compat/runtime.ts
var isDeno, isNode, isBun, isCloudflare;
var init_runtime = __esm({
  "src/platform/compat/runtime.ts"() {
    "use strict";
    isDeno = typeof Deno !== "undefined";
    isNode = typeof globalThis.process !== "undefined" && globalThis.process?.versions?.node !== void 0;
    isBun = typeof globalThis.Bun !== "undefined";
    isCloudflare = typeof globalThis !== "undefined" && "caches" in globalThis && "WebSocketPair" in globalThis;
  }
});

// src/platform/compat/console/ansi.ts
var ansi, red, green, yellow, blue, magenta, cyan, white, gray, bold, dim, italic, underline, strikethrough, reset;
var init_ansi = __esm({
  "src/platform/compat/console/ansi.ts"() {
    ansi = (open, close) => (text2) => \`\\x1B[\${open}m\${text2}\\x1B[\${close}m\`;
    red = ansi(31, 39);
    green = ansi(32, 39);
    yellow = ansi(33, 39);
    blue = ansi(34, 39);
    magenta = ansi(35, 39);
    cyan = ansi(36, 39);
    white = ansi(37, 39);
    gray = ansi(90, 39);
    bold = ansi(1, 22);
    dim = ansi(2, 22);
    italic = ansi(3, 23);
    underline = ansi(4, 24);
    strikethrough = ansi(9, 29);
    reset = (text2) => \`\\x1B[0m\${text2}\`;
  }
});

// src/platform/compat/console/deno.ts
var deno_exports = {};
__export(deno_exports, {
  blue: () => blue,
  bold: () => bold,
  colors: () => colors,
  cyan: () => cyan,
  dim: () => dim,
  gray: () => gray,
  green: () => green,
  italic: () => italic,
  magenta: () => magenta,
  red: () => red,
  reset: () => reset,
  strikethrough: () => strikethrough,
  underline: () => underline,
  white: () => white,
  yellow: () => yellow
});
var colors;
var init_deno2 = __esm({
  "src/platform/compat/console/deno.ts"() {
    "use strict";
    init_ansi();
    colors = {
      // Basic colors
      red,
      green,
      yellow,
      blue,
      cyan,
      magenta,
      white,
      gray,
      // Text modifiers
      bold,
      dim,
      italic,
      underline,
      strikethrough,
      // Utility
      reset
    };
  }
});

// src/platform/compat/console/node.ts
var node_exports = {};
__export(node_exports, {
  blue: () => blue2,
  bold: () => bold2,
  colors: () => colors2,
  cyan: () => cyan2,
  dim: () => dim2,
  gray: () => gray2,
  green: () => green2,
  italic: () => italic2,
  magenta: () => magenta2,
  red: () => red2,
  reset: () => reset2,
  strikethrough: () => strikethrough2,
  underline: () => underline2,
  white: () => white2,
  yellow: () => yellow2
});
import pc from "npm:picocolors";
var colors2, red2, green2, yellow2, blue2, cyan2, magenta2, white2, gray2, bold2, dim2, italic2, underline2, strikethrough2, reset2;
var init_node = __esm({
  "src/platform/compat/console/node.ts"() {
    "use strict";
    colors2 = {
      // Basic colors
      red: pc.red,
      green: pc.green,
      yellow: pc.yellow,
      blue: pc.blue,
      cyan: pc.cyan,
      magenta: pc.magenta,
      white: pc.white,
      gray: pc.gray,
      // Text modifiers
      bold: pc.bold,
      dim: pc.dim,
      italic: pc.italic,
      underline: pc.underline,
      strikethrough: pc.strikethrough,
      // Utility - picocolors doesn't have reset, so we implement it
      reset: (text2) => pc.reset(text2)
    };
    red2 = pc.red;
    green2 = pc.green;
    yellow2 = pc.yellow;
    blue2 = pc.blue;
    cyan2 = pc.cyan;
    magenta2 = pc.magenta;
    white2 = pc.white;
    gray2 = pc.gray;
    bold2 = pc.bold;
    dim2 = pc.dim;
    italic2 = pc.italic;
    underline2 = pc.underline;
    strikethrough2 = pc.strikethrough;
    reset2 = (text2) => pc.reset(text2);
  }
});

// src/platform/compat/console/index.ts
async function loadColors() {
  if (_colors)
    return _colors;
  try {
    if (isDeno) {
      const mod = await Promise.resolve().then(() => (init_deno2(), deno_exports));
      _colors = mod.colors;
    } else {
      const mod = await Promise.resolve().then(() => (init_node(), node_exports));
      _colors = mod.colors;
    }
  } catch {
    _colors = fallbackColors;
  }
  return _colors;
}
var noOp, fallbackColors, _colors, colorsPromise;
var init_console = __esm({
  "src/platform/compat/console/index.ts"() {
    init_runtime();
    noOp = (text2) => text2;
    fallbackColors = {
      red: noOp,
      green: noOp,
      yellow: noOp,
      blue: noOp,
      cyan: noOp,
      magenta: noOp,
      white: noOp,
      gray: noOp,
      bold: noOp,
      dim: noOp,
      italic: noOp,
      underline: noOp,
      strikethrough: noOp,
      reset: noOp
    };
    _colors = null;
    colorsPromise = loadColors();
  }
});

// src/core/errors/user-friendly/error-identifier.ts
var init_error_identifier = __esm({
  "src/core/errors/user-friendly/error-identifier.ts"() {
    "use strict";
  }
});

// src/core/errors/user-friendly/error-formatter.ts
var init_error_formatter = __esm({
  "src/core/errors/user-friendly/error-formatter.ts"() {
    "use strict";
    init_console();
    init_error_catalog();
    init_error_identifier();
  }
});

// src/platform/compat/process.ts
import process2 from "node:process";
var IS_DENO;
var init_process = __esm({
  "src/platform/compat/process.ts"() {
    IS_DENO = typeof Deno !== "undefined" && "Deno" in globalThis;
  }
});

// src/core/errors/user-friendly/error-wrapper.ts
var init_error_wrapper = __esm({
  "src/core/errors/user-friendly/error-wrapper.ts"() {
    "use strict";
    init_console();
    init_process();
    init_logger();
    init_error_formatter();
  }
});

// src/core/errors/user-friendly/index.ts
var init_user_friendly = __esm({
  "src/core/errors/user-friendly/index.ts"() {
    "use strict";
    init_error_catalog();
    init_error_formatter();
    init_error_identifier();
    init_error_wrapper();
  }
});

// src/core/errors/index.ts
var init_errors = __esm({
  "src/core/errors/index.ts"() {
    init_types();
    init_agent_errors();
    init_build_errors();
    init_runtime_errors();
    init_system_errors();
    init_error_handlers();
    init_catalog();
    init_user_friendly();
  }
});

// src/platform/adapters/deno.ts
var DenoFileSystemAdapter, DenoEnvironmentAdapter, DenoServerAdapter, DenoShellAdapter, DenoServer, DenoAdapter, denoAdapter;
var init_deno3 = __esm({
  "src/platform/adapters/deno.ts"() {
    "use strict";
    init_veryfront_error();
    init_config();
    init_utils();
    DenoFileSystemAdapter = class {
      async readFile(path) {
        return await Deno.readTextFile(path);
      }
      async writeFile(path, content) {
        await Deno.writeTextFile(path, content);
      }
      async exists(path) {
        try {
          await Deno.stat(path);
          return true;
        } catch (_error) {
          return false;
        }
      }
      async *readDir(path) {
        for await (const entry of Deno.readDir(path)) {
          yield {
            name: entry.name,
            isFile: entry.isFile,
            isDirectory: entry.isDirectory,
            isSymlink: entry.isSymlink
          };
        }
      }
      async stat(path) {
        const stat = await Deno.stat(path);
        return {
          size: stat.size,
          isFile: stat.isFile,
          isDirectory: stat.isDirectory,
          isSymlink: stat.isSymlink,
          mtime: stat.mtime
        };
      }
      async mkdir(path, options) {
        await Deno.mkdir(path, options);
      }
      async remove(path, options) {
        await Deno.remove(path, options);
      }
      async makeTempDir(prefix) {
        return await Deno.makeTempDir({ prefix });
      }
      watch(paths, options) {
        const pathArray = Array.isArray(paths) ? paths : [paths];
        const recursive = options?.recursive ?? true;
        const signal = options?.signal;
        const watcher = Deno.watchFs(pathArray, { recursive });
        let closed = false;
        const denoIterator = watcher[Symbol.asyncIterator]();
        const mapEventKind = (kind) => {
          switch (kind) {
            case "create":
              return "create";
            case "modify":
              return "modify";
            case "remove":
              return "delete";
            default:
              return "any";
          }
        };
        const iterator = {
          async next() {
            if (closed || signal?.aborted) {
              return { done: true, value: void 0 };
            }
            try {
              const result = await denoIterator.next();
              if (result.done) {
                return { done: true, value: void 0 };
              }
              return {
                done: false,
                value: {
                  kind: mapEventKind(result.value.kind),
                  paths: result.value.paths
                }
              };
            } catch (error2) {
              if (closed || signal?.aborted) {
                return { done: true, value: void 0 };
              }
              throw error2;
            }
          },
          async return() {
            closed = true;
            if (denoIterator.return) {
              await denoIterator.return();
            }
            return { done: true, value: void 0 };
          }
        };
        const cleanup = () => {
          if (closed)
            return;
          closed = true;
          try {
            if ("close" in watcher && typeof watcher.close === "function") {
              watcher.close();
            }
          } catch (error2) {
            serverLogger.debug("[Deno] Filesystem watcher cleanup failed", { error: error2 });
          }
        };
        if (signal) {
          signal.addEventListener("abort", cleanup);
        }
        return {
          [Symbol.asyncIterator]() {
            return iterator;
          },
          close: cleanup
        };
      }
    };
    DenoEnvironmentAdapter = class {
      get(key) {
        return Deno.env.get(key);
      }
      set(key, value) {
        Deno.env.set(key, value);
      }
      toObject() {
        return Deno.env.toObject();
      }
    };
    DenoServerAdapter = class {
      upgradeWebSocket(request) {
        const { socket, response } = Deno.upgradeWebSocket(request);
        return { socket, response };
      }
    };
    DenoShellAdapter = class {
      statSync(path) {
        try {
          const stat = Deno.statSync(path);
          return {
            isFile: stat.isFile,
            isDirectory: stat.isDirectory
          };
        } catch (error2) {
          throw toError(createError({
            type: "file",
            message: \`Failed to stat file: \${error2}\`
          }));
        }
      }
      readFileSync(path) {
        try {
          return Deno.readTextFileSync(path);
        } catch (error2) {
          throw toError(createError({
            type: "file",
            message: \`Failed to read file: \${error2}\`
          }));
        }
      }
    };
    DenoServer = class {
      constructor(server, hostname, port, abortController) {
        this.server = server;
        this.hostname = hostname;
        this.port = port;
        this.abortController = abortController;
      }
      async stop() {
        try {
          if (this.abortController) {
            this.abortController.abort();
          }
          await this.server.shutdown();
        } catch (error2) {
          serverLogger.debug("[Deno] Server shutdown failed", { error: error2 });
        }
      }
      get addr() {
        return { hostname: this.hostname, port: this.port };
      }
    };
    DenoAdapter = class {
      constructor() {
        this.id = "deno";
        this.name = "deno";
        /** @deprecated Use \`id\` instead */
        this.platform = "deno";
        this.fs = new DenoFileSystemAdapter();
        this.env = new DenoEnvironmentAdapter();
        this.server = new DenoServerAdapter();
        this.shell = new DenoShellAdapter();
        this.capabilities = {
          typescript: true,
          jsx: true,
          http2: true,
          websocket: true,
          workers: true,
          fileWatching: true,
          shell: true,
          kvStore: true,
          // Deno KV available
          writableFs: true
        };
        /** @deprecated Use \`capabilities\` instead */
        this.features = {
          websocket: true,
          http2: true,
          workers: true,
          jsx: true,
          typescript: true
        };
      }
      serve(handler, options = {}) {
        const { port = DEFAULT_DEV_PORT, hostname = "localhost", onListen } = options;
        const controller = new AbortController();
        const signal = options.signal || controller.signal;
        const server = Deno.serve({
          port,
          hostname,
          signal,
          handler: async (request, _info) => {
            try {
              return await handler(request);
            } catch (error2) {
              const { serverLogger: serverLogger2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));
              serverLogger2.error("Request handler error:", error2);
              return new Response("Internal Server Error", { status: 500 });
            }
          },
          onListen: (params) => {
            onListen?.({ hostname: params.hostname, port: params.port });
          }
        });
        const controllerToPass = options.signal ? void 0 : controller;
        return Promise.resolve(new DenoServer(server, hostname, port, controllerToPass));
      }
    };
    denoAdapter = new DenoAdapter();
  }
});

// src/rendering/client/router.ts
init_utils();
import ReactDOM from "react-dom/client";

// src/routing/matchers/pattern-route-matcher.ts
init_path_utils();

// src/routing/matchers/index.ts
init_utils();

// src/routing/slug-mapper/path-candidate-generator.ts
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";

// src/routing/client/dom-utils.ts
init_utils();
function isInternalLink(target) {
  const href = target.getAttribute("href");
  if (!href)
    return false;
  if (href.startsWith("http") || href.startsWith("mailto:"))
    return false;
  if (href.startsWith("#"))
    return false;
  if (target.getAttribute("target") === "_blank" || target.getAttribute("download")) {
    return false;
  }
  return true;
}
function findAnchorElement(element) {
  let current = element;
  while (current && current.tagName !== "A") {
    current = current.parentElement;
  }
  if (!current || !(current instanceof HTMLAnchorElement)) {
    return null;
  }
  return current;
}
function updateMetaTags(frontmatter) {
  if (frontmatter.description) {
    updateMetaTag('meta[name="description"]', "name", "description", frontmatter.description);
  }
  if (frontmatter.ogTitle) {
    updateMetaTag('meta[property="og:title"]', "property", "og:title", frontmatter.ogTitle);
  }
}
function updateMetaTag(selector, attributeName, attributeValue, content) {
  let metaTag = document.querySelector(selector);
  if (!metaTag) {
    metaTag = document.createElement("meta");
    metaTag.setAttribute(attributeName, attributeValue);
    document.head.appendChild(metaTag);
  }
  metaTag.setAttribute("content", content);
}
function executeScripts(container) {
  const scripts = container.querySelectorAll("script");
  scripts.forEach((oldScript) => {
    const newScript = document.createElement("script");
    Array.from(oldScript.attributes).forEach((attribute) => {
      newScript.setAttribute(attribute.name, attribute.value);
    });
    newScript.textContent = oldScript.textContent;
    oldScript.parentNode?.replaceChild(newScript, oldScript);
  });
}
function applyHeadDirectives(container) {
  const nodes = container.querySelectorAll('[data-veryfront-head="1"], vf-head');
  if (nodes.length > 0) {
    cleanManagedHeadTags();
  }
  nodes.forEach((wrapper) => {
    processHeadWrapper(wrapper);
    wrapper.parentElement?.removeChild(wrapper);
  });
}
function cleanManagedHeadTags() {
  document.head.querySelectorAll('[data-veryfront-managed="1"]').forEach((element) => element.parentElement?.removeChild(element));
}
function processHeadWrapper(wrapper) {
  wrapper.childNodes.forEach((node) => {
    if (!(node instanceof Element))
      return;
    const tagName = node.tagName.toLowerCase();
    if (tagName === "title") {
      document.title = node.textContent || document.title;
      return;
    }
    const clone = document.createElement(tagName);
    for (const attribute of Array.from(node.attributes)) {
      clone.setAttribute(attribute.name, attribute.value);
    }
    if (node.textContent && !clone.hasAttribute("src")) {
      clone.textContent = node.textContent;
    }
    clone.setAttribute("data-veryfront-managed", "1");
    document.head.appendChild(clone);
  });
}
function manageFocus(container) {
  try {
    const focusElement = container.querySelector("[data-router-focus]") || container.querySelector("main") || container.querySelector("h1");
    if (focusElement && focusElement instanceof HTMLElement && "focus" in focusElement) {
      focusElement.focus({ preventScroll: true });
    }
  } catch (error2) {
    rendererLogger.warn("[router] focus management failed", error2);
  }
}
function extractPageDataFromScript() {
  const pageDataScript = document.querySelector("script[data-veryfront-page]");
  if (!pageDataScript)
    return null;
  try {
    const content = pageDataScript.textContent;
    if (!content) {
      rendererLogger.warn("[dom-utils] Page data script has no content");
      return {};
    }
    return JSON.parse(content);
  } catch (error2) {
    rendererLogger.error("[dom-utils] Failed to parse page data:", error2);
    return null;
  }
}
function parsePageDataFromHTML(html3) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html3, "text/html");
  const root = doc.getElementById("root");
  let content = "";
  if (root) {
    content = root.innerHTML || "";
  } else {
    rendererLogger.warn("[dom-utils] No root element found in HTML");
  }
  const pageDataScript = doc.querySelector("script[data-veryfront-page]");
  let pageData = {};
  if (pageDataScript) {
    try {
      const content2 = pageDataScript.textContent;
      if (!content2) {
        rendererLogger.warn("[dom-utils] Page data script in HTML has no content");
      } else {
        pageData = JSON.parse(content2);
      }
    } catch (error2) {
      rendererLogger.error("[dom-utils] Failed to parse page data from HTML:", error2);
    }
  }
  return { content, pageData };
}

// src/routing/client/navigation-handlers.ts
init_utils();
init_config();
var NavigationHandlers = class {
  constructor(prefetchDelay = DEFAULT_PREFETCH_DELAY_MS, prefetchOptions = {}) {
    this.prefetchQueue = /* @__PURE__ */ new Set();
    this.scrollPositions = /* @__PURE__ */ new Map();
    this.isPopStateNav = false;
    this.prefetchDelay = prefetchDelay;
    this.prefetchOptions = prefetchOptions;
  }
  createClickHandler(callbacks) {
    return (event) => {
      const anchor = findAnchorElement(event.target);
      if (!anchor || !isInternalLink(anchor))
        return;
      const href = anchor.getAttribute("href");
      event.preventDefault();
      callbacks.onNavigate(href);
    };
  }
  createPopStateHandler(callbacks) {
    return (_event) => {
      const path = globalThis.location.pathname;
      this.isPopStateNav = true;
      callbacks.onNavigate(path);
    };
  }
  createMouseOverHandler(callbacks) {
    return (event) => {
      const target = event.target;
      if (target.tagName !== "A")
        return;
      const href = target.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#"))
        return;
      if (!this.shouldPrefetchOnHover(target))
        return;
      if (!this.prefetchQueue.has(href)) {
        this.prefetchQueue.add(href);
        setTimeout(() => {
          callbacks.onPrefetch(href);
          this.prefetchQueue.delete(href);
        }, this.prefetchDelay);
      }
    };
  }
  shouldPrefetchOnHover(target) {
    const prefetchAttribute = target.getAttribute("data-prefetch");
    const isHoverEnabled = Boolean(this.prefetchOptions.hover);
    if (prefetchAttribute === "false")
      return false;
    return prefetchAttribute === "true" || isHoverEnabled;
  }
  saveScrollPosition(path) {
    try {
      const scrollY = globalThis.scrollY;
      if (typeof scrollY === "number") {
        this.scrollPositions.set(path, scrollY);
      } else {
        rendererLogger.debug("[router] No valid scrollY value available");
        this.scrollPositions.set(path, 0);
      }
    } catch (error2) {
      rendererLogger.warn("[router] failed to record scroll position", error2);
    }
  }
  getScrollPosition(path) {
    const position = this.scrollPositions.get(path);
    if (position === void 0) {
      rendererLogger.debug(\`[router] No scroll position stored for \${path}\`);
      return 0;
    }
    return position;
  }
  isPopState() {
    return this.isPopStateNav;
  }
  clearPopStateFlag() {
    this.isPopStateNav = false;
  }
  clear() {
    this.prefetchQueue.clear();
    this.scrollPositions.clear();
    this.isPopStateNav = false;
  }
};

// src/routing/client/page-loader.ts
init_utils();
init_errors();
var PageLoader = class {
  constructor() {
    this.cache = /* @__PURE__ */ new Map();
  }
  getCached(path) {
    return this.cache.get(path);
  }
  isCached(path) {
    return this.cache.has(path);
  }
  setCache(path, data) {
    this.cache.set(path, data);
  }
  clearCache() {
    this.cache.clear();
  }
  async fetchPageData(path) {
    const jsonData = await this.tryFetchJSON(path);
    if (jsonData)
      return jsonData;
    return this.fetchAndParseHTML(path);
  }
  async tryFetchJSON(path) {
    try {
      const response = await fetch(\`/_veryfront/data\${path}.json\`, {
        headers: { "X-Veryfront-Navigation": "client" }
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (error2) {
      rendererLogger.debug(\`[PageLoader] RSC fetch failed for \${path}, falling back to HTML:\`, error2);
    }
    return null;
  }
  async fetchAndParseHTML(path) {
    const response = await fetch(path, {
      headers: { "X-Veryfront-Navigation": "client" }
    });
    if (!response.ok) {
      throw new NetworkError(\`Failed to fetch \${path}\`, {
        status: response.status,
        path
      });
    }
    const html3 = await response.text();
    const { content, pageData } = parsePageDataFromHTML(html3);
    return {
      html: content,
      ...pageData
    };
  }
  async loadPage(path) {
    if (this.isCached(path)) {
      rendererLogger.debug(\`Loading \${path} from cache\`);
      const cachedData = this.getCached(path);
      if (!cachedData) {
        rendererLogger.warn(\`[PageLoader] Cache entry for \${path} was unexpectedly null\`);
      } else {
        return cachedData;
      }
    }
    const data = await this.fetchPageData(path);
    this.setCache(path, data);
    return data;
  }
  async prefetch(path) {
    if (this.isCached(path))
      return;
    rendererLogger.debug(\`Prefetching \${path}\`);
    try {
      const data = await this.fetchPageData(path);
      this.setCache(path, data);
    } catch (error2) {
      rendererLogger.warn(\`Failed to prefetch \${path}\`, error2);
    }
  }
};

// src/routing/client/page-transition.ts
init_utils();
init_config();

// src/security/client/html-sanitizer.ts
var SUSPICIOUS_PATTERNS = [
  { pattern: /<script[^>]*>[\\s\\S]*?<\\/script>/gi, name: "inline script" },
  { pattern: /javascript:/gi, name: "javascript: URL" },
  { pattern: /\\bon\\w+\\s*=/gi, name: "event handler attribute" },
  { pattern: /data:\\s*text\\/html/gi, name: "data: HTML URL" }
];
function isDevMode() {
  if (typeof globalThis !== "undefined") {
    const g = globalThis;
    return g.__VERYFRONT_DEV__ === true || g.Deno?.env?.get?.("VERYFRONT_ENV") === "development";
  }
  return false;
}
function validateTrustedHtml(html3, options = {}) {
  const { strict = false, warn = true } = options;
  for (const { pattern, name } of SUSPICIOUS_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(html3)) {
      const message = \`[Security] Suspicious \${name} detected in server HTML\`;
      if (warn) {
        console.warn(message);
      }
      if (strict || !isDevMode()) {
        throw new Error(\`Potentially unsafe HTML: \${name} detected\`);
      }
    }
  }
  return html3;
}

// src/routing/client/page-transition.ts
var PageTransition = class {
  constructor(setupViewportPrefetch) {
    this.setupViewportPrefetch = setupViewportPrefetch;
  }
  destroy() {
    if (this.pendingTransitionTimeout !== void 0) {
      clearTimeout(this.pendingTransitionTimeout);
      this.pendingTransitionTimeout = void 0;
    }
  }
  updatePage(data, isPopState, scrollY) {
    if (data.frontmatter?.title) {
      document.title = data.frontmatter.title;
    }
    updateMetaTags(data.frontmatter ?? {});
    const rootElement = document.getElementById("root");
    if (rootElement && (data.html ?? "") !== "") {
      this.performTransition(rootElement, data, isPopState, scrollY);
    }
  }
  performTransition(rootElement, data, isPopState, scrollY) {
    if (this.pendingTransitionTimeout !== void 0) {
      clearTimeout(this.pendingTransitionTimeout);
    }
    rootElement.style.opacity = "0";
    this.pendingTransitionTimeout = setTimeout(() => {
      this.pendingTransitionTimeout = void 0;
      rootElement.innerHTML = validateTrustedHtml(String(data.html ?? ""));
      rootElement.style.opacity = "1";
      executeScripts(rootElement);
      applyHeadDirectives(rootElement);
      this.setupViewportPrefetch(rootElement);
      manageFocus(rootElement);
      this.handleScroll(isPopState, scrollY);
    }, PAGE_TRANSITION_DELAY_MS);
  }
  handleScroll(isPopState, scrollY) {
    try {
      globalThis.scrollTo(0, isPopState ? scrollY : 0);
    } catch (error2) {
      rendererLogger.warn("[router] scroll handling failed", error2);
    }
  }
  showError(error2) {
    const rootElement = document.getElementById("root");
    if (!rootElement)
      return;
    const errorDiv = document.createElement("div");
    errorDiv.className = "veryfront-error-page";
    const heading = document.createElement("h1");
    heading.textContent = "Oops! Something went wrong";
    const message = document.createElement("p");
    message.textContent = error2.message;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Reload Page";
    button.onclick = () => globalThis.location.reload();
    errorDiv.appendChild(heading);
    errorDiv.appendChild(message);
    errorDiv.appendChild(button);
    rootElement.innerHTML = "";
    rootElement.appendChild(errorDiv);
  }
  setLoadingState(loading) {
    const indicator = document.getElementById("veryfront-loading");
    if (indicator) {
      indicator.style.display = loading ? "block" : "none";
    }
    document.body.classList.toggle("veryfront-loading", loading);
  }
};

// src/routing/client/viewport-prefetch.ts
init_utils();
var ViewportPrefetch = class {
  constructor(prefetchCallback, prefetchOptions = {}) {
    this.observer = null;
    this.prefetchCallback = prefetchCallback;
    this.prefetchOptions = prefetchOptions;
  }
  setup(root) {
    try {
      if (!("IntersectionObserver" in globalThis))
        return;
      if (this.observer)
        this.observer.disconnect();
      this.createObserver();
      this.observeLinks(root);
    } catch (error2) {
      rendererLogger.debug("[router] setupViewportPrefetch failed", error2);
    }
  }
  createObserver() {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const isAnchor = typeof HTMLAnchorElement !== "undefined" ? entry.target instanceof HTMLAnchorElement : entry.target.tagName === "A";
            if (isAnchor) {
              const href = entry.target.getAttribute("href");
              if (href) {
                this.prefetchCallback(href);
              }
              this.observer?.unobserve(entry.target);
            }
          }
        }
      },
      { rootMargin: "200px" }
    );
  }
  observeLinks(root) {
    const anchors = root.querySelectorAll?.('a[href]:not([target="_blank"])') ?? document.createDocumentFragment().querySelectorAll("a");
    const isViewportEnabled = Boolean(this.prefetchOptions.viewport);
    anchors.forEach((anchor) => {
      if (this.shouldObserveAnchor(anchor, isViewportEnabled)) {
        this.observer?.observe(anchor);
      }
    });
  }
  shouldObserveAnchor(anchor, isViewportEnabled) {
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("http") || href.startsWith("#") || anchor.getAttribute("download")) {
      return false;
    }
    const prefetchAttribute = anchor.getAttribute("data-prefetch");
    if (prefetchAttribute === "false")
      return false;
    return prefetchAttribute === "viewport" || isViewportEnabled;
  }
  disconnect() {
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch (error2) {
        rendererLogger.warn("[router] prefetchObserver.disconnect failed", error2);
      }
      this.observer = null;
    }
  }
};

// src/routing/api/handler.ts
init_utils();
init_std_path();
init_config();

// src/core/utils/lru-wrapper.ts
init_utils();

// src/routing/api/handler.ts
init_veryfront_error();

// src/security/http/response/constants.ts
var CONTENT_TYPES = {
  JSON: "application/json; charset=utf-8",
  HTML: "text/html; charset=utf-8",
  TEXT: "text/plain; charset=utf-8",
  JAVASCRIPT: "application/javascript; charset=utf-8",
  CSS: "text/css; charset=utf-8",
  XML: "application/xml; charset=utf-8"
};
var CACHE_DURATIONS = {
  SHORT: 60,
  MEDIUM: 3600,
  LONG: 31536e3
};

// src/security/http/cors/validators.ts
init_logger();

// src/observability/tracing/manager.ts
init_utils();

// src/observability/tracing/config.ts
var DEFAULT_CONFIG2 = {
  enabled: false,
  exporter: "console",
  serviceName: "veryfront",
  sampleRate: 1,
  debug: false
};
function loadConfig(config = {}, adapter) {
  const finalConfig = { ...DEFAULT_CONFIG2, ...config };
  if (adapter?.env) {
    applyEnvFromAdapter(finalConfig, adapter.env);
  } else {
    applyEnvFromDeno(finalConfig);
  }
  return finalConfig;
}
function applyEnvFromAdapter(config, envAdapter) {
  if (!envAdapter)
    return;
  const otelEnabled = envAdapter.get("OTEL_TRACES_ENABLED");
  const veryfrontOtel = envAdapter.get("VERYFRONT_OTEL");
  const serviceName = envAdapter.get("OTEL_SERVICE_NAME");
  config.enabled = otelEnabled === "true" || veryfrontOtel === "1" || config.enabled;
  if (serviceName)
    config.serviceName = serviceName;
  const otlpEndpoint = envAdapter.get("OTEL_EXPORTER_OTLP_ENDPOINT");
  const tracesEndpoint = envAdapter.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
  config.endpoint = otlpEndpoint || tracesEndpoint || config.endpoint;
  const exporterType = envAdapter.get("OTEL_TRACES_EXPORTER");
  if (isValidExporter(exporterType)) {
    config.exporter = exporterType;
  }
}
function applyEnvFromDeno(config) {
  try {
    const denoEnv = globalThis.Deno?.env;
    if (!denoEnv)
      return;
    config.enabled = denoEnv.get("OTEL_TRACES_ENABLED") === "true" || denoEnv.get("VERYFRONT_OTEL") === "1" || config.enabled;
    config.serviceName = denoEnv.get("OTEL_SERVICE_NAME") || config.serviceName;
    config.endpoint = denoEnv.get("OTEL_EXPORTER_OTLP_ENDPOINT") || denoEnv.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") || config.endpoint;
    const exporterType = denoEnv.get("OTEL_TRACES_EXPORTER");
    if (isValidExporter(exporterType)) {
      config.exporter = exporterType;
    }
  } catch {
  }
}
function isValidExporter(value) {
  return value === "jaeger" || value === "zipkin" || value === "otlp" || value === "console";
}

// src/observability/tracing/span-operations.ts
init_utils();
var SpanOperations = class {
  constructor(api, tracer2) {
    this.api = api;
    this.tracer = tracer2;
  }
  startSpan(name, options = {}) {
    try {
      const spanKind = this.mapSpanKind(options.kind);
      const span = this.tracer.startSpan(name, {
        kind: spanKind,
        attributes: options.attributes || {}
      }, options.parent);
      return span;
    } catch (error2) {
      serverLogger.debug("[tracing] Failed to start span", { name, error: error2 });
      return null;
    }
  }
  endSpan(span, error2) {
    if (!span)
      return;
    try {
      if (error2) {
        span.recordException(error2);
        span.setStatus({
          code: this.api.SpanStatusCode.ERROR,
          message: error2.message
        });
      } else {
        span.setStatus({ code: this.api.SpanStatusCode.OK });
      }
      span.end();
    } catch (err) {
      serverLogger.debug("[tracing] Failed to end span", err);
    }
  }
  setAttributes(span, attributes) {
    if (!span)
      return;
    try {
      span.setAttributes(attributes);
    } catch (error2) {
      serverLogger.debug("[tracing] Failed to set span attributes", error2);
    }
  }
  addEvent(span, name, attributes) {
    if (!span)
      return;
    try {
      span.addEvent(name, attributes);
    } catch (error2) {
      serverLogger.debug("[tracing] Failed to add span event", error2);
    }
  }
  createChildSpan(parentSpan, name, options = {}) {
    if (!parentSpan)
      return this.startSpan(name, options);
    try {
      const parentContext = this.api.trace.setSpan(this.api.context.active(), parentSpan);
      return this.startSpan(name, { ...options, parent: parentContext });
    } catch (error2) {
      serverLogger.debug("[tracing] Failed to create child span", error2);
      return null;
    }
  }
  mapSpanKind(kind) {
    if (!kind)
      return this.api.SpanKind.INTERNAL;
    const kindMap = {
      "internal": this.api.SpanKind.INTERNAL,
      "server": this.api.SpanKind.SERVER,
      "client": this.api.SpanKind.CLIENT,
      "producer": this.api.SpanKind.PRODUCER,
      "consumer": this.api.SpanKind.CONSUMER
    };
    return kindMap[kind.toLowerCase()] || this.api.SpanKind.INTERNAL;
  }
};

// src/observability/tracing/context-propagation.ts
init_utils();
var ContextPropagation = class {
  constructor(api, propagator) {
    this.api = api;
    this.propagator = propagator;
  }
  extractContext(headers) {
    try {
      const carrier = {};
      headers.forEach((value, key) => {
        carrier[key] = value;
      });
      return this.api.propagation.extract(this.api.context.active(), carrier);
    } catch (error2) {
      serverLogger.debug("[tracing] Failed to extract context from headers", error2);
      return void 0;
    }
  }
  injectContext(context, headers) {
    try {
      const carrier = {};
      this.api.propagation.inject(context, carrier);
      for (const [key, value] of Object.entries(carrier)) {
        headers.set(key, value);
      }
    } catch (error2) {
      serverLogger.debug("[tracing] Failed to inject context into headers", error2);
    }
  }
  getActiveContext() {
    try {
      return this.api.context.active();
    } catch (error2) {
      serverLogger.debug("[tracing] Failed to get active context", error2);
      return void 0;
    }
  }
  async withActiveSpan(span, fn) {
    if (!span)
      return await fn();
    try {
      return await this.api.context.with(
        this.api.trace.setSpan(this.api.context.active(), span),
        fn
      );
    } catch (error2) {
      throw error2;
    }
  }
  withSpan(name, fn, startSpan2, endSpan2) {
    const span = startSpan2(name);
    try {
      const result = fn(span);
      endSpan2(span);
      return result;
    } catch (error2) {
      endSpan2(span, error2);
      throw error2;
    }
  }
  async withSpanAsync(name, fn, startSpan2, endSpan2) {
    const span = startSpan2(name);
    try {
      const result = await fn(span);
      endSpan2(span);
      return result;
    } catch (error2) {
      endSpan2(span, error2);
      throw error2;
    }
  }
};

// src/observability/tracing/manager.ts
var TracingManager = class {
  constructor() {
    this.state = {
      initialized: false,
      tracer: null,
      api: null,
      propagator: null
    };
    this.spanOps = null;
    this.contextProp = null;
  }
  async initialize(config = {}, adapter) {
    if (this.state.initialized) {
      serverLogger.debug("[tracing] Already initialized");
      return;
    }
    const finalConfig = loadConfig(config, adapter);
    if (!finalConfig.enabled) {
      serverLogger.debug("[tracing] Tracing disabled");
      this.state.initialized = true;
      return;
    }
    try {
      await this.initializeTracer(finalConfig);
      this.state.initialized = true;
      serverLogger.info("[tracing] OpenTelemetry tracing initialized", {
        exporter: finalConfig.exporter,
        serviceName: finalConfig.serviceName,
        endpoint: finalConfig.endpoint
      });
    } catch (error2) {
      serverLogger.warn("[tracing] Failed to initialize OpenTelemetry tracing", error2);
      this.state.initialized = true;
    }
  }
  async initializeTracer(config) {
    const api = await import("npm:@opentelemetry/api@1");
    this.state.api = api;
    this.state.tracer = api.trace.getTracer(config.serviceName || "veryfront", "0.1.0");
    const { W3CTraceContextPropagator } = await import("npm:@opentelemetry/core@1");
    this.state.propagator = new W3CTraceContextPropagator();
    api.propagation.setGlobalPropagator(this.state.propagator);
    if (this.state.api && this.state.tracer) {
      this.spanOps = new SpanOperations(this.state.api, this.state.tracer);
    }
    if (this.state.api && this.state.propagator) {
      this.contextProp = new ContextPropagation(this.state.api, this.state.propagator);
    }
  }
  isEnabled() {
    return this.state.initialized && this.state.tracer !== null;
  }
  getSpanOperations() {
    return this.spanOps;
  }
  getContextPropagation() {
    return this.contextProp;
  }
  getState() {
    return this.state;
  }
  shutdown() {
    if (!this.state.initialized)
      return;
    try {
      serverLogger.info("[tracing] Tracing shutdown initiated");
    } catch (error2) {
      serverLogger.warn("[tracing] Error during tracing shutdown", error2);
    }
  }
};
var tracingManager = new TracingManager();

// src/observability/metrics/manager.ts
init_utils();

// src/observability/metrics/config.ts
var DEFAULT_METRICS_COLLECT_INTERVAL_MS2 = 6e4;
var DEFAULT_CONFIG3 = {
  enabled: false,
  exporter: "console",
  prefix: "veryfront",
  collectInterval: DEFAULT_METRICS_COLLECT_INTERVAL_MS2,
  debug: false
};
function loadConfig2(config, adapter) {
  const finalConfig = { ...DEFAULT_CONFIG3, ...config };
  if (adapter?.env) {
    const envAdapter = adapter.env;
    const otelEnabled = envAdapter.get("OTEL_METRICS_ENABLED");
    const veryfrontOtel = envAdapter.get("VERYFRONT_OTEL");
    finalConfig.enabled = otelEnabled === "true" || veryfrontOtel === "1" || finalConfig.enabled;
    const otlpEndpoint = envAdapter.get("OTEL_EXPORTER_OTLP_ENDPOINT");
    const metricsEndpoint = envAdapter.get(
      "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"
    );
    finalConfig.endpoint = otlpEndpoint || metricsEndpoint || finalConfig.endpoint;
    const exporterType = envAdapter.get("OTEL_METRICS_EXPORTER");
    if (exporterType === "prometheus" || exporterType === "otlp" || exporterType === "console") {
      finalConfig.exporter = exporterType;
    }
  } else {
    try {
      const denoEnv = globalThis.Deno?.env;
      if (denoEnv) {
        finalConfig.enabled = denoEnv.get("OTEL_METRICS_ENABLED") === "true" || denoEnv.get("VERYFRONT_OTEL") === "1" || finalConfig.enabled;
        finalConfig.endpoint = denoEnv.get("OTEL_EXPORTER_OTLP_ENDPOINT") || denoEnv.get("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") || finalConfig.endpoint;
        const exporterType = denoEnv.get("OTEL_METRICS_EXPORTER");
        if (exporterType === "prometheus" || exporterType === "otlp" || exporterType === "console") {
          finalConfig.exporter = exporterType;
        }
      }
    } catch {
    }
  }
  return finalConfig;
}
function getMemoryUsage() {
  try {
    if (globalThis.Deno?.memoryUsage) {
      return globalThis.Deno.memoryUsage();
    }
    const proc = globalThis.process;
    if (proc?.memoryUsage) {
      return proc.memoryUsage();
    }
    return null;
  } catch {
    return null;
  }
}

// src/observability/instruments/instruments-factory.ts
init_utils();

// src/observability/instruments/build-instruments.ts
init_config();
function createBuildInstruments(meter, config) {
  const buildDuration = meter.createHistogram(
    \`\${config.prefix}.build.duration\`,
    {
      description: "Build operation duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS }
    }
  );
  const bundleSizeHistogram = meter.createHistogram(
    \`\${config.prefix}.build.bundle.size\`,
    {
      description: "Bundle size distribution",
      unit: "kb",
      advice: { explicitBucketBoundaries: SIZE_HISTOGRAM_BOUNDARIES_KB }
    }
  );
  const bundleCounter = meter.createCounter(
    \`\${config.prefix}.build.bundles\`,
    {
      description: "Total number of bundles created",
      unit: "bundles"
    }
  );
  return {
    buildDuration,
    bundleSizeHistogram,
    bundleCounter
  };
}

// src/observability/instruments/cache-instruments.ts
function createCacheInstruments(meter, config, runtimeState) {
  const cacheGetCounter = meter.createCounter(
    \`\${config.prefix}.cache.gets\`,
    {
      description: "Total number of cache get operations",
      unit: "operations"
    }
  );
  const cacheHitCounter = meter.createCounter(
    \`\${config.prefix}.cache.hits\`,
    {
      description: "Total number of cache hits",
      unit: "hits"
    }
  );
  const cacheMissCounter = meter.createCounter(
    \`\${config.prefix}.cache.misses\`,
    {
      description: "Total number of cache misses",
      unit: "misses"
    }
  );
  const cacheSetCounter = meter.createCounter(
    \`\${config.prefix}.cache.sets\`,
    {
      description: "Total number of cache set operations",
      unit: "operations"
    }
  );
  const cacheInvalidateCounter = meter.createCounter(
    \`\${config.prefix}.cache.invalidations\`,
    {
      description: "Total number of cache invalidations",
      unit: "operations"
    }
  );
  const cacheSizeGauge = meter.createObservableGauge(
    \`\${config.prefix}.cache.size\`,
    {
      description: "Current cache size",
      unit: "entries"
    }
  );
  cacheSizeGauge.addCallback((result) => {
    result.observe(runtimeState.cacheSize);
  });
  return {
    cacheGetCounter,
    cacheHitCounter,
    cacheMissCounter,
    cacheSetCounter,
    cacheInvalidateCounter,
    cacheSizeGauge
  };
}

// src/observability/instruments/data-instruments.ts
init_config();
function createDataInstruments(meter, config) {
  const dataFetchDuration = meter.createHistogram(
    \`\${config.prefix}.data.fetch.duration\`,
    {
      description: "Data fetch duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS }
    }
  );
  const dataFetchCounter = meter.createCounter(
    \`\${config.prefix}.data.fetch.count\`,
    {
      description: "Total number of data fetches",
      unit: "fetches"
    }
  );
  const dataFetchErrorCounter = meter.createCounter(
    \`\${config.prefix}.data.fetch.errors\`,
    {
      description: "Data fetch errors",
      unit: "errors"
    }
  );
  return {
    dataFetchDuration,
    dataFetchCounter,
    dataFetchErrorCounter
  };
}

// src/observability/instruments/http-instruments.ts
init_config();
function createHttpInstruments(meter, config) {
  const httpRequestCounter = meter.createCounter(
    \`\${config.prefix}.http.requests\`,
    {
      description: "Total number of HTTP requests",
      unit: "requests"
    }
  );
  const httpRequestDuration = meter.createHistogram(
    \`\${config.prefix}.http.request.duration\`,
    {
      description: "HTTP request duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS }
    }
  );
  const httpActiveRequests = meter.createUpDownCounter(
    \`\${config.prefix}.http.requests.active\`,
    {
      description: "Number of active HTTP requests",
      unit: "requests"
    }
  );
  return {
    httpRequestCounter,
    httpRequestDuration,
    httpActiveRequests
  };
}

// src/observability/instruments/memory-instruments.ts
function createMemoryInstruments(meter, config) {
  const memoryUsageGauge = meter.createObservableGauge(
    \`\${config.prefix}.memory.usage\`,
    {
      description: "Memory usage",
      unit: "bytes"
    }
  );
  memoryUsageGauge.addCallback((result) => {
    const memoryUsage = getMemoryUsage();
    if (memoryUsage) {
      result.observe(memoryUsage.rss);
    }
  });
  const heapUsageGauge = meter.createObservableGauge(
    \`\${config.prefix}.memory.heap\`,
    {
      description: "Heap memory usage",
      unit: "bytes"
    }
  );
  heapUsageGauge.addCallback((result) => {
    const memoryUsage = getMemoryUsage();
    if (memoryUsage) {
      result.observe(memoryUsage.heapUsed);
    }
  });
  return {
    memoryUsageGauge,
    heapUsageGauge
  };
}

// src/observability/instruments/render-instruments.ts
init_config();
function createRenderInstruments(meter, config) {
  const renderDuration = meter.createHistogram(
    \`\${config.prefix}.render.duration\`,
    {
      description: "Page render duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS }
    }
  );
  const renderCounter = meter.createCounter(
    \`\${config.prefix}.render.count\`,
    {
      description: "Total number of page renders",
      unit: "renders"
    }
  );
  const renderErrorCounter = meter.createCounter(
    \`\${config.prefix}.render.errors\`,
    {
      description: "Total number of render errors",
      unit: "errors"
    }
  );
  return {
    renderDuration,
    renderCounter,
    renderErrorCounter
  };
}

// src/observability/instruments/rsc-instruments.ts
init_config();
function createRscInstruments(meter, config) {
  const rscRenderDuration = meter.createHistogram(
    \`\${config.prefix}.rsc.render.duration\`,
    {
      description: "RSC render duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS }
    }
  );
  const rscStreamDuration = meter.createHistogram(
    \`\${config.prefix}.rsc.stream.duration\`,
    {
      description: "RSC stream duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS }
    }
  );
  const rscManifestCounter = meter.createCounter(
    \`\${config.prefix}.rsc.manifest\`,
    {
      description: "RSC manifest requests",
      unit: "requests"
    }
  );
  const rscPageCounter = meter.createCounter(
    \`\${config.prefix}.rsc.page\`,
    {
      description: "RSC page requests",
      unit: "requests"
    }
  );
  const rscStreamCounter = meter.createCounter(
    \`\${config.prefix}.rsc.stream\`,
    {
      description: "RSC stream requests",
      unit: "requests"
    }
  );
  const rscActionCounter = meter.createCounter(
    \`\${config.prefix}.rsc.action\`,
    {
      description: "RSC action requests",
      unit: "requests"
    }
  );
  const rscErrorCounter = meter.createCounter(
    \`\${config.prefix}.rsc.errors\`,
    {
      description: "RSC errors",
      unit: "errors"
    }
  );
  return {
    rscRenderDuration,
    rscStreamDuration,
    rscManifestCounter,
    rscPageCounter,
    rscStreamCounter,
    rscActionCounter,
    rscErrorCounter
  };
}

// src/observability/instruments/instruments-factory.ts
async function initializeInstruments(meter, config, runtimeState) {
  const instruments = {
    httpRequestCounter: null,
    httpRequestDuration: null,
    httpActiveRequests: null,
    cacheGetCounter: null,
    cacheHitCounter: null,
    cacheMissCounter: null,
    cacheSetCounter: null,
    cacheInvalidateCounter: null,
    cacheSizeGauge: null,
    renderDuration: null,
    renderCounter: null,
    renderErrorCounter: null,
    rscRenderDuration: null,
    rscStreamDuration: null,
    rscManifestCounter: null,
    rscPageCounter: null,
    rscStreamCounter: null,
    rscActionCounter: null,
    rscErrorCounter: null,
    buildDuration: null,
    bundleSizeHistogram: null,
    bundleCounter: null,
    dataFetchDuration: null,
    dataFetchCounter: null,
    dataFetchErrorCounter: null,
    corsRejectionCounter: null,
    securityHeadersCounter: null,
    memoryUsageGauge: null,
    heapUsageGauge: null
  };
  try {
    const httpInstruments = createHttpInstruments(meter, config);
    Object.assign(instruments, httpInstruments);
    const cacheInstruments = createCacheInstruments(meter, config, runtimeState);
    Object.assign(instruments, cacheInstruments);
    const renderInstruments = createRenderInstruments(meter, config);
    Object.assign(instruments, renderInstruments);
    const rscInstruments = createRscInstruments(meter, config);
    Object.assign(instruments, rscInstruments);
    const buildInstruments = createBuildInstruments(meter, config);
    Object.assign(instruments, buildInstruments);
    const dataInstruments = createDataInstruments(meter, config);
    Object.assign(instruments, dataInstruments);
    const memoryInstruments = createMemoryInstruments(meter, config);
    Object.assign(instruments, memoryInstruments);
  } catch (error2) {
    serverLogger.warn("[metrics] Failed to initialize metric instruments", error2);
  }
  await Promise.resolve();
  return instruments;
}

// src/observability/metrics/recorder.ts
var MetricsRecorder = class {
  constructor(instruments, runtimeState) {
    this.instruments = instruments;
    this.runtimeState = runtimeState;
    this.stateLock = { locked: false };
  }
  /**
   * Execute state mutation atomically to prevent race conditions
   */
  atomicUpdate(fn) {
    while (this.stateLock.locked) {
    }
    this.stateLock.locked = true;
    try {
      fn();
    } finally {
      this.stateLock.locked = false;
    }
  }
  // HTTP Metrics
  recordHttpRequest(attributes) {
    this.instruments.httpRequestCounter?.add(1, attributes);
    this.instruments.httpActiveRequests?.add(1, attributes);
    this.atomicUpdate(() => {
      this.runtimeState.activeRequests++;
    });
  }
  recordHttpRequestComplete(durationMs, attributes) {
    this.instruments.httpRequestDuration?.record(durationMs, attributes);
    this.instruments.httpActiveRequests?.add(-1, attributes);
    this.atomicUpdate(() => {
      this.runtimeState.activeRequests--;
    });
  }
  // Cache Metrics
  recordCacheGet(hit, attributes) {
    this.instruments.cacheGetCounter?.add(1, attributes);
    if (hit) {
      this.instruments.cacheHitCounter?.add(1, attributes);
    } else {
      this.instruments.cacheMissCounter?.add(1, attributes);
    }
  }
  recordCacheSet(attributes) {
    this.instruments.cacheSetCounter?.add(1, attributes);
    this.atomicUpdate(() => {
      this.runtimeState.cacheSize++;
    });
  }
  recordCacheInvalidate(count, attributes) {
    this.instruments.cacheInvalidateCounter?.add(count, attributes);
    this.atomicUpdate(() => {
      this.runtimeState.cacheSize = Math.max(
        0,
        this.runtimeState.cacheSize - count
      );
    });
  }
  setCacheSize(size) {
    this.atomicUpdate(() => {
      this.runtimeState.cacheSize = size;
    });
  }
  // Render Metrics
  recordRender(durationMs, attributes) {
    this.instruments.renderDuration?.record(durationMs, attributes);
    this.instruments.renderCounter?.add(1, attributes);
  }
  recordRenderError(attributes) {
    this.instruments.renderErrorCounter?.add(1, attributes);
  }
  // RSC Metrics
  recordRSCRender(durationMs, attributes) {
    this.instruments.rscRenderDuration?.record(durationMs, attributes);
  }
  recordRSCStream(durationMs, attributes) {
    this.instruments.rscStreamDuration?.record(durationMs, attributes);
  }
  recordRSCRequest(type, attributes) {
    switch (type) {
      case "manifest":
        this.instruments.rscManifestCounter?.add(1, attributes);
        break;
      case "page":
        this.instruments.rscPageCounter?.add(1, attributes);
        break;
      case "stream":
        this.instruments.rscStreamCounter?.add(1, attributes);
        break;
      case "action":
        this.instruments.rscActionCounter?.add(1, attributes);
        break;
    }
  }
  recordRSCError(attributes) {
    this.instruments.rscErrorCounter?.add(1, attributes);
  }
  // Build Metrics
  recordBuild(durationMs, attributes) {
    this.instruments.buildDuration?.record(durationMs, attributes);
  }
  recordBundle(sizeKb, attributes) {
    this.instruments.bundleSizeHistogram?.record(sizeKb, attributes);
    this.instruments.bundleCounter?.add(1, attributes);
  }
  // Data Fetching Metrics
  recordDataFetch(durationMs, attributes) {
    this.instruments.dataFetchDuration?.record(durationMs, attributes);
    this.instruments.dataFetchCounter?.add(1, attributes);
  }
  recordDataFetchError(attributes) {
    this.instruments.dataFetchErrorCounter?.add(1, attributes);
  }
  // Security Metrics
  recordCorsRejection(attributes) {
    this.instruments.corsRejectionCounter?.add(1, attributes);
  }
  recordSecurityHeaders(attributes) {
    this.instruments.securityHeadersCounter?.add(1, attributes);
  }
};

// src/observability/metrics/manager.ts
var MetricsManager = class {
  constructor() {
    this.initialized = false;
    this.meter = null;
    this.api = null;
    this.recorder = null;
    this.instruments = this.createEmptyInstruments();
    this.runtimeState = {
      cacheSize: 0,
      activeRequests: 0
    };
    this.recorder = new MetricsRecorder(this.instruments, this.runtimeState);
  }
  createEmptyInstruments() {
    return {
      httpRequestCounter: null,
      httpRequestDuration: null,
      httpActiveRequests: null,
      cacheGetCounter: null,
      cacheHitCounter: null,
      cacheMissCounter: null,
      cacheSetCounter: null,
      cacheInvalidateCounter: null,
      cacheSizeGauge: null,
      renderDuration: null,
      renderCounter: null,
      renderErrorCounter: null,
      rscRenderDuration: null,
      rscStreamDuration: null,
      rscManifestCounter: null,
      rscPageCounter: null,
      rscStreamCounter: null,
      rscActionCounter: null,
      rscErrorCounter: null,
      buildDuration: null,
      bundleSizeHistogram: null,
      bundleCounter: null,
      dataFetchDuration: null,
      dataFetchCounter: null,
      dataFetchErrorCounter: null,
      corsRejectionCounter: null,
      securityHeadersCounter: null,
      memoryUsageGauge: null,
      heapUsageGauge: null
    };
  }
  async initialize(config = {}, adapter) {
    if (this.initialized) {
      serverLogger.debug("[metrics] Already initialized");
      return;
    }
    const finalConfig = loadConfig2(config, adapter);
    if (!finalConfig.enabled) {
      serverLogger.debug("[metrics] Metrics collection disabled");
      this.initialized = true;
      return;
    }
    try {
      this.api = await import("npm:@opentelemetry/api@1");
      this.meter = this.api.metrics.getMeter(finalConfig.prefix, "0.1.0");
      this.instruments = await initializeInstruments(
        this.meter,
        finalConfig,
        this.runtimeState
      );
      if (this.recorder) {
        this.recorder.instruments = this.instruments;
      }
      this.initialized = true;
      serverLogger.info("[metrics] OpenTelemetry metrics initialized", {
        exporter: finalConfig.exporter,
        endpoint: finalConfig.endpoint,
        prefix: finalConfig.prefix
      });
    } catch (error2) {
      serverLogger.warn("[metrics] Failed to initialize OpenTelemetry metrics", error2);
      this.initialized = true;
    }
  }
  isEnabled() {
    return this.initialized && this.meter !== null;
  }
  getRecorder() {
    return this.recorder;
  }
  getState() {
    return {
      initialized: this.initialized,
      cacheSize: this.runtimeState.cacheSize,
      activeRequests: this.runtimeState.activeRequests
    };
  }
  shutdown() {
    if (!this.initialized)
      return;
    try {
      serverLogger.info("[metrics] Metrics shutdown initiated");
    } catch (error2) {
      serverLogger.warn("[metrics] Error during metrics shutdown", error2);
    }
  }
};
var metricsManager = new MetricsManager();

// src/observability/metrics/index.ts
var getRecorder = () => metricsManager.getRecorder();
function recordCorsRejection(attributes) {
  getRecorder()?.recordCorsRejection?.(attributes);
}
function recordSecurityHeaders(attributes) {
  getRecorder()?.recordSecurityHeaders?.(attributes);
}

// src/observability/auto-instrument/orchestrator.ts
init_utils();

// src/observability/auto-instrument/http-instrumentation.ts
init_utils();
import {
  context as otContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace
} from "npm:@opentelemetry/api@1";
var tracer = trace.getTracer("veryfront-http");

// src/security/http/cors/validators.ts
async function validateOrigin(requestOrigin, config) {
  if (!config) {
    return { allowedOrigin: null, allowCredentials: false };
  }
  if (config === true) {
    const origin = requestOrigin || "*";
    return { allowedOrigin: origin, allowCredentials: false };
  }
  const corsConfig = config;
  if (!corsConfig.origin) {
    return { allowedOrigin: null, allowCredentials: false };
  }
  if (!requestOrigin) {
    if (corsConfig.origin === "*") {
      return { allowedOrigin: "*", allowCredentials: false };
    }
    return { allowedOrigin: null, allowCredentials: false };
  }
  if (corsConfig.origin === "*") {
    if (corsConfig.credentials) {
      serverLogger.warn("[CORS] Cannot use credentials with wildcard origin - denying");
      return {
        allowedOrigin: null,
        allowCredentials: false,
        error: "Cannot use credentials with wildcard origin"
      };
    }
    return { allowedOrigin: "*", allowCredentials: false };
  }
  if (typeof corsConfig.origin === "function") {
    try {
      const result = await corsConfig.origin(requestOrigin);
      if (typeof result === "string") {
        return {
          allowedOrigin: result,
          allowCredentials: corsConfig.credentials ?? false
        };
      }
      const allowed = result === true;
      return {
        allowedOrigin: allowed ? requestOrigin : null,
        allowCredentials: allowed && (corsConfig.credentials ?? false),
        error: allowed ? void 0 : "Origin rejected by validation function"
      };
    } catch (error2) {
      serverLogger.error("[CORS] Origin validation function error", error2);
      return {
        allowedOrigin: null,
        allowCredentials: false,
        error: "Origin validation error"
      };
    }
  }
  if (Array.isArray(corsConfig.origin)) {
    const allowed = corsConfig.origin.includes(requestOrigin);
    if (!allowed) {
      recordCorsRejection();
      serverLogger.warn("[CORS] Origin not in allowlist", {
        requestOrigin,
        allowedOrigins: corsConfig.origin
      });
    }
    return {
      allowedOrigin: allowed ? requestOrigin : null,
      allowCredentials: allowed && (corsConfig.credentials ?? false),
      error: allowed ? void 0 : "Origin not in allowlist"
    };
  }
  if (typeof corsConfig.origin === "string") {
    const allowed = corsConfig.origin === requestOrigin;
    if (!allowed) {
      recordCorsRejection();
      serverLogger.warn("[CORS] Origin does not match", {
        requestOrigin,
        expectedOrigin: corsConfig.origin
      });
    }
    return {
      allowedOrigin: allowed ? requestOrigin : null,
      allowCredentials: allowed && (corsConfig.credentials ?? false),
      error: allowed ? void 0 : "Origin does not match"
    };
  }
  return {
    allowedOrigin: null,
    allowCredentials: false,
    error: "Invalid origin configuration"
  };
}
function validateOriginSync(requestOrigin, config) {
  if (!config) {
    return { allowedOrigin: null, allowCredentials: false };
  }
  if (config === true) {
    const origin = requestOrigin || "*";
    return { allowedOrigin: origin, allowCredentials: false };
  }
  const corsConfig = config;
  if (!corsConfig.origin) {
    return { allowedOrigin: null, allowCredentials: false };
  }
  if (!requestOrigin) {
    if (corsConfig.origin === "*") {
      return { allowedOrigin: "*", allowCredentials: false };
    }
    return { allowedOrigin: null, allowCredentials: false };
  }
  if (corsConfig.origin === "*") {
    if (corsConfig.credentials) {
      serverLogger.warn("[CORS] Cannot use credentials with wildcard origin - denying");
      return {
        allowedOrigin: null,
        allowCredentials: false,
        error: "Cannot use credentials with wildcard origin"
      };
    }
    return { allowedOrigin: "*", allowCredentials: false };
  }
  if (typeof corsConfig.origin === "function") {
    try {
      const result = corsConfig.origin(requestOrigin);
      if (result instanceof Promise) {
        serverLogger.warn(
          "[CORS] Async origin validators are not supported in synchronous contexts"
        );
        return {
          allowedOrigin: null,
          allowCredentials: false,
          error: "Async origin validators not supported"
        };
      }
      if (typeof result === "string") {
        return {
          allowedOrigin: result,
          allowCredentials: corsConfig.credentials ?? false
        };
      }
      const allowed = result === true;
      return {
        allowedOrigin: allowed ? requestOrigin : null,
        allowCredentials: allowed && (corsConfig.credentials ?? false),
        error: allowed ? void 0 : "Origin rejected by validation function"
      };
    } catch (error2) {
      serverLogger.error("[CORS] Origin validation function error", error2);
      return {
        allowedOrigin: null,
        allowCredentials: false,
        error: "Origin validation error"
      };
    }
  }
  if (Array.isArray(corsConfig.origin)) {
    const allowed = corsConfig.origin.includes(requestOrigin);
    if (!allowed) {
      recordCorsRejection();
      serverLogger.warn("[CORS] Origin not in allowlist (sync)", {
        requestOrigin,
        allowedOrigins: corsConfig.origin
      });
    }
    return {
      allowedOrigin: allowed ? requestOrigin : null,
      allowCredentials: allowed && (corsConfig.credentials ?? false),
      error: allowed ? void 0 : "Origin not in allowlist"
    };
  }
  if (typeof corsConfig.origin === "string") {
    const allowed = corsConfig.origin === requestOrigin;
    if (!allowed) {
      recordCorsRejection();
      serverLogger.warn("[CORS] Origin does not match (sync)", {
        requestOrigin,
        expectedOrigin: corsConfig.origin
      });
    }
    return {
      allowedOrigin: allowed ? requestOrigin : null,
      allowCredentials: allowed && (corsConfig.credentials ?? false),
      error: allowed ? void 0 : "Origin does not match"
    };
  }
  return {
    allowedOrigin: null,
    allowCredentials: false,
    error: "Invalid origin configuration"
  };
}

// src/security/http/cors/headers.ts
async function applyCORSHeaders(options) {
  const { request, response, headers: headersObj, config } = options;
  const validation = await validateOrigin(request.headers.get("origin"), config);
  if (!validation.allowedOrigin) {
    return response;
  }
  const headers = headersObj || (response ? new Headers(response.headers) : new Headers());
  headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);
  if (validation.allowedOrigin !== "*") {
    const existingVary = headers.get("Vary");
    const varyValues = existingVary ? existingVary.split(",").map((v) => v.trim()) : [];
    if (!varyValues.includes("Origin")) {
      varyValues.push("Origin");
      headers.set("Vary", varyValues.join(", "));
    }
  }
  if (validation.allowCredentials && validation.allowedOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  const corsConfig = typeof config === "object" ? config : null;
  if (corsConfig?.exposedHeaders && corsConfig.exposedHeaders.length > 0) {
    headers.set("Access-Control-Expose-Headers", corsConfig.exposedHeaders.join(", "));
  }
  if (response) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
  return;
}
function applyCORSHeadersSync(options) {
  const { request, response, headers: headersObj, config } = options;
  const validation = validateOriginSync(request.headers.get("origin"), config);
  if (!validation.allowedOrigin) {
    return response;
  }
  const headers = headersObj || (response ? new Headers(response.headers) : new Headers());
  headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);
  if (validation.allowedOrigin !== "*") {
    const existingVary = headers.get("Vary");
    const varyValues = existingVary ? existingVary.split(",").map((v) => v.trim()) : [];
    if (!varyValues.includes("Origin")) {
      varyValues.push("Origin");
      headers.set("Vary", varyValues.join(", "));
    }
  }
  if (validation.allowCredentials && validation.allowedOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  const corsConfig = typeof config === "object" ? config : null;
  if (corsConfig?.exposedHeaders && corsConfig.exposedHeaders.length > 0) {
    headers.set("Access-Control-Expose-Headers", corsConfig.exposedHeaders.join(", "));
  }
  if (response) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
  return;
}

// src/security/http/cors/constants.ts
init_config();

// src/security/http/cors/preflight.ts
init_logger();

// src/security/http/cors/middleware.ts
init_veryfront_error();

// src/security/http/response/security-handler.ts
init_utils();
function generateNonce() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}
function buildCSP(isDev, nonce, cspUserHeader, config, adapter) {
  const envCsp = adapter?.env?.get?.("VERYFRONT_CSP");
  if (envCsp?.trim())
    return envCsp.replace(/{NONCE}/g, nonce);
  const defaultCsp = isDev ? [
    "default-src 'self'",
    \`style-src 'self' 'nonce-\${nonce}' 'unsafe-inline' https://esm.sh https://cdnjs.cloudflare.com https://cdn.veryfront.com https://cdn.jsdelivr.net\`,
    "img-src 'self' data: https://cdn.veryfront.com https://cdnjs.cloudflare.com",
    \`script-src 'self' 'nonce-\${nonce}' 'unsafe-eval' https://esm.sh https://cdn.tailwindcss.com\`,
    "connect-src 'self' https://esm.sh ws://localhost:* wss://localhost:*",
    "font-src 'self' data: https://cdnjs.cloudflare.com"
  ].join("; ") : [
    "default-src 'self'",
    \`style-src 'self' 'nonce-\${nonce}'\`,
    "img-src 'self' data:",
    \`script-src 'self' 'nonce-\${nonce}'\`,
    "connect-src 'self'"
  ].join("; ");
  if (cspUserHeader?.trim()) {
    return \`\${cspUserHeader.replace(/{NONCE}/g, nonce)}; \${defaultCsp}\`;
  }
  const cfgCsp = config?.csp;
  if (cfgCsp && typeof cfgCsp === "object") {
    const pieces = [];
    for (const [k, v] of Object.entries(cfgCsp)) {
      if (v === void 0)
        continue;
      const key = String(k).replace(/[A-Z]/g, (m) => \`-\${m.toLowerCase()}\`);
      const val = Array.isArray(v) ? v.join(" ") : String(v);
      pieces.push(\`\${key} \${val}\`.replace(/{NONCE}/g, nonce));
    }
    if (pieces.length > 0) {
      return \`\${pieces.join("; ")}; \${defaultCsp}\`;
    }
  }
  return defaultCsp;
}
function getSecurityHeader(headerName, defaultValue, config, adapter) {
  const configKey = headerName.toLowerCase();
  const configValue = config?.[configKey];
  const envValue = adapter?.env?.get?.(\`VERYFRONT_\${headerName}\`);
  return (typeof configValue === "string" ? configValue : void 0) || envValue || defaultValue;
}
function applySecurityHeaders(headers, isDev, nonce, cspUserHeader, config, adapter) {
  serverLogger.debug("[NONCE-TRACE] applySecurityHeaders called", { nonce });
  const getHeaderOverride = (name) => {
    const overrides = config?.headers;
    if (!overrides)
      return void 0;
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(overrides)) {
      if (key.toLowerCase() === lower) {
        return value;
      }
    }
    return void 0;
  };
  const contentTypeOptions = getHeaderOverride("x-content-type-options") ?? "nosniff";
  headers.set("X-Content-Type-Options", contentTypeOptions);
  const frameOptions = getHeaderOverride("x-frame-options") ?? "DENY";
  headers.set("X-Frame-Options", frameOptions);
  const xssProtection = getHeaderOverride("x-xss-protection") ?? "1; mode=block";
  headers.set("X-XSS-Protection", xssProtection);
  const csp = buildCSP(isDev, nonce, cspUserHeader, config, adapter);
  if (csp) {
    headers.set("Content-Security-Policy", csp);
  }
  if (!isDev) {
    const hstsMaxAge = config?.hsts?.maxAge ?? 31536e3;
    const hstsIncludeSubDomains = config?.hsts?.includeSubDomains ?? true;
    const hstsPreload = config?.hsts?.preload ?? false;
    let hstsValue = \`max-age=\${hstsMaxAge}\`;
    if (hstsIncludeSubDomains) {
      hstsValue += "; includeSubDomains";
    }
    if (hstsPreload) {
      hstsValue += "; preload";
    }
    const hstsOverride = getHeaderOverride("strict-transport-security");
    headers.set("Strict-Transport-Security", hstsOverride ?? hstsValue);
  }
  const coop = getSecurityHeader("COOP", "same-origin", config, adapter);
  const corp = getSecurityHeader("CORP", "same-origin", config, adapter);
  const coep = getSecurityHeader("COEP", "", config, adapter);
  headers.set("Cross-Origin-Opener-Policy", coop);
  headers.set("Cross-Origin-Resource-Policy", corp);
  if (coep) {
    headers.set("Cross-Origin-Embedder-Policy", coep);
  }
  if (config?.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      if (value === void 0)
        continue;
      headers.set(key, value);
    }
  }
  recordSecurityHeaders();
}

// src/security/http/response/cache-handler.ts
function buildCacheControl(strategy) {
  let cacheControl;
  if (typeof strategy === "string") {
    switch (strategy) {
      case "no-cache":
        cacheControl = "no-cache, no-store, must-revalidate";
        break;
      case "no-store":
        cacheControl = "no-store";
        break;
      case "short":
        cacheControl = \`public, max-age=\${CACHE_DURATIONS.SHORT}\`;
        break;
      case "medium":
        cacheControl = \`public, max-age=\${CACHE_DURATIONS.MEDIUM}\`;
        break;
      case "long":
        cacheControl = \`public, max-age=\${CACHE_DURATIONS.LONG}\`;
        break;
      case "immutable":
        cacheControl = \`public, max-age=\${CACHE_DURATIONS.LONG}, immutable\`;
        break;
      case "none":
        cacheControl = "no-cache, no-store, must-revalidate";
        break;
      default:
        cacheControl = "public, max-age=0";
    }
  } else {
    const parts = [];
    parts.push(strategy.public !== false ? "public" : "private");
    parts.push(\`max-age=\${strategy.maxAge}\`);
    if (strategy.immutable)
      parts.push("immutable");
    if (strategy.mustRevalidate)
      parts.push("must-revalidate");
    cacheControl = parts.join(", ");
  }
  return cacheControl;
}

// src/security/http/response/fluent-methods.ts
function withCORS(req, corsConfig) {
  const config = corsConfig ?? this.securityConfig?.cors;
  applyCORSHeadersSync({
    request: req,
    headers: this.headers,
    config
  });
  return this;
}
function withCORSAsync(req) {
  return applyCORSHeaders({
    request: req,
    headers: this.headers,
    config: this.securityConfig?.cors
  }).then(() => this);
}
function withSecurity(config) {
  const cfg = config ?? this.securityConfig;
  applySecurityHeaders(
    this.headers,
    this.isDev,
    this.nonce,
    this.cspUserHeader,
    cfg,
    this.adapter
  );
  return this;
}
function withCache(strategy) {
  const cacheControl = buildCacheControl(strategy);
  this.headers.set("cache-control", cacheControl);
  return this;
}
function withETag(etag) {
  this.headers.set("ETag", etag);
  return this;
}
function withHeaders(headers) {
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      this.headers.set(key, value);
    });
  } else if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      this.headers.set(key, value);
    });
  } else {
    Object.entries(headers).forEach(([key, value]) => {
      this.headers.set(key, value);
    });
  }
  return this;
}
function withStatus(status) {
  this.status = status;
  return this;
}
function withAllow(methods) {
  const methodStr = Array.isArray(methods) ? methods.join(", ") : methods;
  this.headers.set("Allow", methodStr);
  this.headers.set("Access-Control-Allow-Methods", methodStr);
  return this;
}

// src/security/http/response/response-methods.ts
function json(data, status) {
  this.headers.set("content-type", CONTENT_TYPES.JSON);
  return new Response(JSON.stringify(data), {
    status: status ?? this.status,
    headers: this.headers
  });
}
function text(body, status) {
  this.headers.set("content-type", CONTENT_TYPES.TEXT);
  return new Response(body, {
    status: status ?? this.status,
    headers: this.headers
  });
}
function html(body, status) {
  this.headers.set("content-type", CONTENT_TYPES.HTML);
  return new Response(body, {
    status: status ?? this.status,
    headers: this.headers
  });
}
function javascript(code, status) {
  this.headers.set("content-type", CONTENT_TYPES.JAVASCRIPT);
  return new Response(code, {
    status: status ?? this.status,
    headers: this.headers
  });
}
function withContentType(contentType, body, status) {
  this.headers.set("content-type", contentType);
  return new Response(body, {
    status: status ?? this.status,
    headers: this.headers
  });
}
function build(body = null, status) {
  return new Response(body, {
    status: status ?? this.status,
    headers: this.headers
  });
}
function notModified(etag) {
  if (etag) {
    this.headers.set("ETag", etag);
  }
  return new Response(null, {
    status: 304,
    headers: this.headers
  });
}

// src/security/http/response/static-helpers.ts
init_veryfront_error();
var ResponseBuilderClass = null;
function setResponseBuilderClass(builderClass) {
  ResponseBuilderClass = builderClass;
}
function error(status, message, req, config) {
  if (!ResponseBuilderClass) {
    throw toError(createError({
      type: "config",
      message: "ResponseBuilder class not initialized"
    }));
  }
  const builder = new ResponseBuilderClass(config);
  builder.withCORS(req, config?.corsConfig);
  if (config?.securityConfig !== void 0) {
    builder.withSecurity(config.securityConfig ?? void 0);
  }
  const contentType = config?.contentType ?? CONTENT_TYPES.TEXT;
  if (contentType === CONTENT_TYPES.JSON) {
    return builder.json({ error: message }, status);
  } else if (contentType === CONTENT_TYPES.HTML) {
    return builder.html(message, status);
  }
  return builder.text(message, status);
}
function json2(data, req, config) {
  if (!ResponseBuilderClass) {
    throw toError(createError({
      type: "config",
      message: "ResponseBuilder class not initialized"
    }));
  }
  const builder = new ResponseBuilderClass(config);
  builder.withCORS(req, config?.corsConfig);
  if (config?.securityConfig !== void 0) {
    builder.withSecurity(config.securityConfig ?? void 0);
  }
  if (config?.cache) {
    builder.withCache(config.cache);
  }
  if (config?.etag) {
    builder.withETag(config.etag);
  }
  return builder.json(data, config?.status);
}
function html2(body, req, config) {
  if (!ResponseBuilderClass) {
    throw toError(createError({
      type: "config",
      message: "ResponseBuilder class not initialized"
    }));
  }
  const builder = new ResponseBuilderClass(config);
  builder.withCORS(req, config?.corsConfig);
  if (config?.securityConfig !== void 0) {
    builder.withSecurity(config.securityConfig ?? void 0);
  }
  if (config?.cache) {
    builder.withCache(config.cache);
  }
  if (config?.etag) {
    builder.withETag(config.etag);
  }
  return builder.html(body, config?.status);
}
function preflight(req, config) {
  if (!ResponseBuilderClass) {
    throw toError(createError({
      type: "config",
      message: "ResponseBuilder class not initialized"
    }));
  }
  const builder = new ResponseBuilderClass(config);
  builder.withCORS(req, config?.corsConfig);
  if (config?.securityConfig !== void 0) {
    builder.withSecurity(config.securityConfig ?? void 0);
  }
  const methods = config?.allowMethods ?? "GET,POST,PUT,PATCH,DELETE,OPTIONS";
  builder.withAllow(methods);
  const headers = config?.allowHeaders ?? req.headers.get("access-control-request-headers") ?? "Content-Type,Authorization";
  builder.headers.set(
    "Access-Control-Allow-Headers",
    Array.isArray(headers) ? headers.join(", ") : headers
  );
  return builder.build(null, 204);
}
function stream(streamData, req, config) {
  if (!ResponseBuilderClass) {
    throw toError(createError({
      type: "config",
      message: "ResponseBuilder class not initialized"
    }));
  }
  const builder = new ResponseBuilderClass(config);
  builder.withCORS(req, config?.corsConfig);
  if (config?.securityConfig !== void 0) {
    builder.withSecurity(config.securityConfig ?? void 0);
  }
  if (config?.cache) {
    builder.withCache(config.cache);
  }
  const contentType = config?.contentType ?? "application/octet-stream";
  return builder.withContentType(contentType, streamData);
}

// src/security/http/response/builder.ts
init_utils();
var ResponseBuilder = class {
  constructor(config) {
    // Fluent methods - bind imported functions to this instance
    this.withCORS = withCORS;
    this.withCORSAsync = withCORSAsync;
    this.withSecurity = withSecurity;
    this.withCache = withCache;
    this.withETag = withETag;
    this.withHeaders = withHeaders;
    this.withStatus = withStatus;
    this.withAllow = withAllow;
    // Response methods - bind imported functions to this instance
    this.json = json;
    this.text = text;
    this.html = html;
    this.javascript = javascript;
    this.withContentType = withContentType;
    this.build = build;
    this.notModified = notModified;
    this.headers = new Headers();
    this.status = 200;
    this.securityConfig = config?.securityConfig ?? null;
    this.isDev = config?.isDev ?? false;
    this.nonce = config?.nonce ?? generateNonce();
    serverLogger.debug("[NONCE-TRACE] ResponseBuilder nonce", {
      nonce: this.nonce,
      provided: !!config?.nonce
    });
    this.cspUserHeader = config?.cspUserHeader ?? null;
    this.adapter = config?.adapter;
  }
};
// Static helper methods - delegate to static-helpers module
ResponseBuilder.error = error;
ResponseBuilder.json = json2;
ResponseBuilder.html = html2;
ResponseBuilder.preflight = preflight;
ResponseBuilder.stream = stream;
setResponseBuilderClass(ResponseBuilder);

// src/security/http/base-handler.ts
init_utils();

// src/core/constants/index.ts
init_constants();

// src/core/constants/buffers.ts
var DEFAULT_MAX_BODY_SIZE_BYTES = 1024 * 1024;
var DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
var PREFETCH_QUEUE_MAX_SIZE_BYTES = 1024 * 1024;
var MAX_BUNDLE_CHUNK_SIZE_BYTES = 4096 * 1024;

// src/core/constants/limits.ts
var MAX_URL_LENGTH_FOR_VALIDATION = 2048;

// src/security/input-validation/parsers.ts
import { z as z2 } from "zod";

// src/security/input-validation/schemas.ts
import { z as z3 } from "zod";
var CommonSchemas = {
  /**
   * Valid email address (RFC-compliant, max 255 chars)
   */
  email: z3.string().email().max(255),
  /**
   * Valid UUID v4 identifier
   */
  uuid: z3.string().uuid(),
  /**
   * URL-safe slug (lowercase alphanumeric with hyphens)
   */
  slug: z3.string().regex(/^[a-z0-9-]+\$/).min(1).max(100),
  /**
   * Valid HTTP/HTTPS URL (max 2048 chars)
   */
  url: z3.string().url().max(MAX_URL_LENGTH_FOR_VALIDATION),
  /**
   * International phone number (E.164 format)
   */
  phoneNumber: z3.string().regex(/^\\+?[1-9]\\d{1,14}\$/),
  /**
   * Pagination parameters with defaults
   */
  pagination: z3.object({
    page: z3.coerce.number().int().positive().default(1),
    limit: z3.coerce.number().int().positive().max(100).default(10),
    sort: z3.string().optional(),
    order: z3.enum(["asc", "desc"]).optional()
  }),
  /**
   * Date range with validation
   */
  dateRange: z3.object({
    from: z3.string().datetime(),
    to: z3.string().datetime()
  }).refine((data) => new Date(data.from) <= new Date(data.to), {
    message: "From date must be before or equal to To date"
  }),
  /**
   * Strong password requirements
   * - Minimum 8 characters
   * - At least one uppercase letter
   * - At least one lowercase letter
   * - At least one number
   * - At least one special character
   */
  strongPassword: z3.string().min(8, "Password must be at least 8 characters").regex(/[A-Z]/, "Password must contain at least one uppercase letter").regex(/[a-z]/, "Password must contain at least one lowercase letter").regex(/[0-9]/, "Password must contain at least one number").regex(/[^A-Za-z0-9]/, "Password must contain at least one special character")
};

// src/security/http/auth.ts
init_veryfront_error();

// src/security/http/config.ts
init_config();
init_utils();

// src/security/http/middleware/config-loader.ts
init_utils();

// src/security/http/middleware/etag.ts
init_hash();

// src/security/http/middleware/content-types.ts
init_http();

// src/security/path-validation.ts
init_utils();

// src/security/secure-fs.ts
init_utils();

// src/routing/api/module-loader/loader.ts
init_utils();
init_std_path();

// src/routing/api/module-loader/esbuild-plugin.ts
init_utils();
init_utils();
init_utils();

// src/routing/api/module-loader/http-validator.ts
init_veryfront_error();

// src/routing/api/module-loader/security-config.ts
init_utils();
init_utils();

// src/routing/api/module-loader/loader.ts
init_veryfront_error();

// src/routing/api/route-discovery.ts
init_std_path();

// src/core/utils/file-discovery.ts
init_std_path();
init_deno3();

// src/routing/api/route-executor.ts
init_utils();
init_veryfront_error();

// src/routing/api/method-validator.ts
init_utils();

// src/routing/api/error-handler.ts
init_utils();
init_utils();
init_utils();

// src/rendering/client/router.ts
var VeryfrontRouter = class {
  constructor(options = {}) {
    this.root = null;
    const globalOptions = this.loadGlobalOptions();
    this.options = { ...globalOptions, ...options };
    this.baseUrl = options.baseUrl || globalThis.location.origin;
    this.currentPath = globalThis.location.pathname;
    this.pageLoader = new PageLoader();
    this.navigationHandlers = new NavigationHandlers(
      this.options.prefetchDelay,
      this.options.prefetch
    );
    this.pageTransition = new PageTransition((root) => this.viewportPrefetch.setup(root));
    this.viewportPrefetch = new ViewportPrefetch(
      (path) => this.prefetch(path),
      this.options.prefetch
    );
    this.handleClick = this.navigationHandlers.createClickHandler({
      onNavigate: (url) => this.navigate(url),
      onPrefetch: (url) => this.prefetch(url)
    });
    this.handlePopState = this.navigationHandlers.createPopStateHandler({
      onNavigate: (url) => this.navigate(url, false),
      onPrefetch: (url) => this.prefetch(url)
    });
    this.handleMouseOver = this.navigationHandlers.createMouseOverHandler({
      onNavigate: (url) => this.navigate(url),
      onPrefetch: (url) => this.prefetch(url)
    });
  }
  loadGlobalOptions() {
    try {
      const options = globalThis.__VERYFRONT_ROUTER_OPTS__;
      if (!options) {
        rendererLogger.debug("[router] No global options configured");
        return {};
      }
      return options;
    } catch (error2) {
      rendererLogger.error("[router] Failed to read global options:", error2);
      return {};
    }
  }
  init() {
    rendererLogger.info("Initializing client-side router");
    const rootElement = document.getElementById("root");
    if (!rootElement) {
      rendererLogger.error("Root element not found");
      return;
    }
    const ReactDOMToUse = globalThis.ReactDOM || ReactDOM;
    this.root = ReactDOMToUse.createRoot(rootElement);
    document.addEventListener("click", this.handleClick);
    globalThis.addEventListener("popstate", this.handlePopState);
    document.addEventListener("mouseover", this.handleMouseOver);
    this.viewportPrefetch.setup(document);
    this.cacheCurrentPage();
  }
  cacheCurrentPage() {
    const pageData = extractPageDataFromScript();
    if (pageData) {
      this.pageLoader.setCache(this.currentPath, pageData);
    }
  }
  async navigate(url, pushState = true) {
    rendererLogger.info(\`Navigating to \${url}\`);
    this.navigationHandlers.saveScrollPosition(this.currentPath);
    this.options.onStart?.(url);
    if (pushState) {
      globalThis.history.pushState({}, "", url);
    }
    await this.loadPage(url);
    this.options.onNavigate?.(url);
  }
  async loadPage(path, updateUI = true) {
    if (this.pageLoader.isCached(path)) {
      rendererLogger.debug(\`Loading \${path} from cache\`);
      const data = this.pageLoader.getCached(path);
      if (!data) {
        rendererLogger.warn(\`[router] Cache entry for \${path} was unexpectedly null, fetching fresh data\`);
      } else {
        if (updateUI) {
          this.updatePage(data);
        }
        return;
      }
    }
    this.pageTransition.setLoadingState(true);
    try {
      const data = await this.pageLoader.loadPage(path);
      if (updateUI) {
        this.updatePage(data);
      }
      this.currentPath = path;
      this.options.onComplete?.(path);
    } catch (error2) {
      rendererLogger.error(\`Failed to load \${path}\`, error2);
      this.options.onError?.(error2);
      this.pageTransition.showError(error2);
    } finally {
      this.pageTransition.setLoadingState(false);
    }
  }
  async prefetch(path) {
    await this.pageLoader.prefetch(path);
  }
  updatePage(data) {
    if (!this.root)
      return;
    const isPopState = this.navigationHandlers.isPopState();
    const scrollY = this.navigationHandlers.getScrollPosition(this.currentPath);
    this.pageTransition.updatePage(data, isPopState, scrollY);
    this.navigationHandlers.clearPopStateFlag();
  }
  destroy() {
    document.removeEventListener("click", this.handleClick);
    globalThis.removeEventListener("popstate", this.handlePopState);
    document.removeEventListener("mouseover", this.handleMouseOver);
    this.viewportPrefetch.disconnect();
    this.pageLoader.clearCache();
    this.navigationHandlers.clear();
    this.pageTransition.destroy();
  }
};
if (typeof window !== "undefined" && globalThis.document) {
  const router = new VeryfrontRouter();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => router.init());
  } else {
    router.init();
  }
  globalThis.veryFrontRouter = router;
}
export {
  VeryfrontRouter
};
`;

/**
 * Pre-bundled client prefetch script for npm builds
 * Placeholder - this is auto-generated during build:npm
 */
export const CLIENT_PREFETCH_BUNDLE: string = `// src/rendering/client/browser-logger.ts
var ConditionalBrowserLogger = class {
  constructor(prefix, level) {
    this.prefix = prefix;
    this.level = level;
  }
  debug(message, ...args) {
    if (this.level <= 0 /* DEBUG */) {
      console.debug?.(\`[\${this.prefix}] DEBUG: \${message}\`, ...args);
    }
  }
  info(message, ...args) {
    if (this.level <= 1 /* INFO */) {
      console.log?.(\`[\${this.prefix}] \${message}\`, ...args);
    }
  }
  warn(message, ...args) {
    if (this.level <= 2 /* WARN */) {
      console.warn?.(\`[\${this.prefix}] WARN: \${message}\`, ...args);
    }
  }
  error(message, ...args) {
    if (this.level <= 3 /* ERROR */) {
      console.error?.(\`[\${this.prefix}] ERROR: \${message}\`, ...args);
    }
  }
};
function getBrowserLogLevel() {
  if (typeof window === "undefined") {
    return 2 /* WARN */;
  }
  const windowObject = window;
  const isDevelopment = windowObject.__VERYFRONT_DEV__ || windowObject.__RSC_DEV__;
  if (!isDevelopment) {
    return 2 /* WARN */;
  }
  const isDebugEnabled = windowObject.__VERYFRONT_DEBUG__ || windowObject.__RSC_DEBUG__;
  return isDebugEnabled ? 0 /* DEBUG */ : 1 /* INFO */;
}
var defaultLevel = getBrowserLogLevel();
var rscLogger = new ConditionalBrowserLogger("RSC", defaultLevel);
var prefetchLogger = new ConditionalBrowserLogger("PREFETCH", defaultLevel);
var hydrateLogger = new ConditionalBrowserLogger("HYDRATE", defaultLevel);
var browserLogger = new ConditionalBrowserLogger("VERYFRONT", defaultLevel);

// src/rendering/client/prefetch/link-observer.ts
var LinkObserver = class {
  constructor(options, prefetchedUrls) {
    this.intersectionObserver = null;
    this.mutationObserver = null;
    this.pendingTimeouts = /* @__PURE__ */ new Map();
    this.elementTimeoutMap = /* @__PURE__ */ new WeakMap();
    // Track which timeout belongs to which element
    this.timeoutCounter = 0;
    this.options = options;
    this.prefetchedUrls = prefetchedUrls;
  }
  init() {
    this.createIntersectionObserver();
    this.observeLinks();
    this.setupMutationObserver();
  }
  createIntersectionObserver() {
    this.intersectionObserver = new IntersectionObserver(
      (entries) => this.handleIntersection(entries),
      { rootMargin: this.options.rootMargin }
    );
  }
  handleIntersection(entries) {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const target = entry.target;
        let isAnchor = false;
        if (typeof HTMLAnchorElement !== "undefined") {
          isAnchor = target instanceof HTMLAnchorElement;
        } else {
          isAnchor = target.tagName === "A";
        }
        if (!isAnchor) {
          continue;
        }
        const link = target;
        const timeoutKey = this.timeoutCounter++;
        const timeoutId = setTimeout(() => {
          this.pendingTimeouts.delete(timeoutKey);
          this.elementTimeoutMap.delete(link);
          this.options.onLinkVisible(link);
        }, this.options.delay);
        this.pendingTimeouts.set(timeoutKey, timeoutId);
        this.elementTimeoutMap.set(link, timeoutKey);
      }
    }
  }
  observeLinks() {
    const links = document.querySelectorAll('a[href^="/"], a[href^="./"]');
    links.forEach((link) => {
      if (this.isValidLink(link)) {
        this.intersectionObserver?.observe(link);
      }
    });
  }
  setupMutationObserver() {
    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.observeElement(node);
            }
          });
          mutation.removedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.clearElementTimeouts(node);
            }
          });
        }
      }
    });
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  clearElementTimeouts(element) {
    if (element.tagName === "A") {
      const timeoutKey = this.elementTimeoutMap.get(element);
      if (timeoutKey !== void 0) {
        const timeoutId = this.pendingTimeouts.get(timeoutKey);
        if (timeoutId) {
          clearTimeout(timeoutId);
          this.pendingTimeouts.delete(timeoutKey);
        }
        this.elementTimeoutMap.delete(element);
      }
    }
    const links = element.querySelectorAll("a");
    links.forEach((link) => {
      const timeoutKey = this.elementTimeoutMap.get(link);
      if (timeoutKey !== void 0) {
        const timeoutId = this.pendingTimeouts.get(timeoutKey);
        if (timeoutId) {
          clearTimeout(timeoutId);
          this.pendingTimeouts.delete(timeoutKey);
        }
        this.elementTimeoutMap.delete(link);
      }
    });
  }
  observeElement(element) {
    const isAnchor = typeof HTMLAnchorElement !== "undefined" ? element instanceof HTMLAnchorElement : element.tagName === "A";
    if (isAnchor && this.isValidLink(element)) {
      this.intersectionObserver?.observe(element);
    }
    const links = element.querySelectorAll('a[href^="/"], a[href^="./"]');
    links.forEach((link) => {
      const isLinkAnchor = typeof HTMLAnchorElement !== "undefined" ? link instanceof HTMLAnchorElement : link.tagName === "A";
      if (isLinkAnchor && this.isValidLink(link)) {
        this.intersectionObserver?.observe(link);
      }
    });
  }
  isValidLink(link) {
    if (link.hostname !== globalThis.location.hostname)
      return false;
    if (link.hasAttribute("download"))
      return false;
    if (link.target === "_blank")
      return false;
    const url = link.href;
    if (this.prefetchedUrls.has(url))
      return false;
    if (url === globalThis.location.href)
      return false;
    if (link.hash && link.pathname === globalThis.location.pathname) {
      return false;
    }
    if (link.dataset.noPrefetch)
      return false;
    return true;
  }
  destroy() {
    for (const [_, timeoutId] of this.pendingTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingTimeouts.clear();
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
  }
};

// src/rendering/client/prefetch/network-utils.ts
var NetworkUtils = class {
  constructor(allowedNetworks = ["4g", "wifi", "ethernet"]) {
    this.allowedNetworks = allowedNetworks;
    this.networkInfo = this.getNetworkConnection();
  }
  getNavigatorWithConnection() {
    if (typeof globalThis.navigator === "undefined") {
      return null;
    }
    return globalThis.navigator;
  }
  getNetworkConnection() {
    const nav = this.getNavigatorWithConnection();
    return nav?.connection || nav?.mozConnection || nav?.webkitConnection || null;
  }
  shouldPrefetch() {
    const nav = this.getNavigatorWithConnection();
    if (nav?.connection?.saveData) {
      return false;
    }
    if (this.networkInfo) {
      const effectiveType = this.networkInfo.effectiveType;
      if (effectiveType !== void 0 && !this.allowedNetworks.includes(effectiveType)) {
        return false;
      }
    }
    return true;
  }
  onNetworkChange(callback) {
    if (this.networkInfo?.addEventListener) {
      this.networkInfo.addEventListener("change", callback);
    }
  }
  getNetworkInfo() {
    return this.networkInfo;
  }
};

// src/core/utils/constants/cache.ts
var SECONDS_PER_MINUTE = 60;
var MINUTES_PER_HOUR = 60;
var HOURS_PER_DAY = 24;
var MS_PER_SECOND = 1e3;
var COMPONENT_LOADER_TTL_MS = 10 * MINUTES_PER_HOUR * MS_PER_SECOND;
var MDX_RENDERER_TTL_MS = 10 * MINUTES_PER_HOUR * MS_PER_SECOND;
var RENDERER_CORE_TTL_MS = 5 * MINUTES_PER_HOUR * MS_PER_SECOND;
var TSX_LAYOUT_TTL_MS = 10 * MINUTES_PER_HOUR * MS_PER_SECOND;
var DATA_FETCHING_TTL_MS = 10 * MINUTES_PER_HOUR * MS_PER_SECOND;
var MDX_CACHE_TTL_PRODUCTION_MS = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
var MDX_CACHE_TTL_DEVELOPMENT_MS = 5 * MINUTES_PER_HOUR * MS_PER_SECOND;
var BUNDLE_CACHE_TTL_PRODUCTION_MS = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
var BUNDLE_CACHE_TTL_DEVELOPMENT_MS = 5 * MINUTES_PER_HOUR * MS_PER_SECOND;
var BUNDLE_MANIFEST_PROD_TTL_MS = 7 * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
var BUNDLE_MANIFEST_DEV_TTL_MS = MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
var SERVER_ACTION_DEFAULT_TTL_SEC = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
var ONE_DAY_MS = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
var LRU_DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024;

// src/core/utils/constants/http.ts
var KB_IN_BYTES = 1024;
var PREFETCH_MAX_SIZE_BYTES = 200 * KB_IN_BYTES;
var PREFETCH_DEFAULT_TIMEOUT_MS = 1e4;
var PREFETCH_DEFAULT_DELAY_MS = 200;

// src/core/utils/constants/hmr.ts
var HMR_MAX_MESSAGE_SIZE_BYTES = 1024 * KB_IN_BYTES;

// src/core/utils/constants/network.ts
var BYTES_PER_MB = 1024 * 1024;

// src/core/constants/buffers.ts
var DEFAULT_MAX_BODY_SIZE_BYTES = 1024 * 1024;
var DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
var PREFETCH_QUEUE_MAX_SIZE_BYTES = 1024 * 1024;
var MAX_BUNDLE_CHUNK_SIZE_BYTES = 4096 * 1024;

// src/rendering/client/prefetch/prefetch-queue.ts
var DEFAULT_OPTIONS = {
  maxConcurrent: 4,
  maxSize: PREFETCH_QUEUE_MAX_SIZE_BYTES,
  // 1MB
  timeout: 5e3
};
function isAbortError(error) {
  return Boolean(
    error && typeof error === "object" && "name" in error && error.name === "AbortError"
  );
}
var PrefetchQueue = class {
  constructor(options = {}, prefetchedUrls) {
    this.controllers = /* @__PURE__ */ new Map();
    this.concurrent = 0;
    this.stopped = false;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.prefetchedUrls = prefetchedUrls ?? /* @__PURE__ */ new Set();
  }
  setResourceCallback(callback) {
    this.onResourcesFetched = callback;
  }
  enqueue(url) {
    void this.prefetch(url);
  }
  has(url) {
    return this.prefetchedUrls.has(url) || this.controllers.has(url);
  }
  get size() {
    return this.getQueueSize();
  }
  clear() {
    this.stopAll();
    this.prefetchedUrls.clear();
  }
  start() {
    this.stopped = false;
  }
  stop() {
    this.stopped = true;
    this.stopAll();
  }
  getQueueSize() {
    return this.controllers.size;
  }
  getConcurrentCount() {
    return this.concurrent;
  }
  async prefetchLink(link) {
    if (this.stopped) {
      return;
    }
    const url = link.href;
    if (!url || this.controllers.has(url) || this.prefetchedUrls.has(url)) {
      return;
    }
    if (this.concurrent >= this.options.maxConcurrent) {
      prefetchLogger.debug?.(\`Prefetch queue full, skipping \${url}\`);
      return;
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (_error) {
      prefetchLogger.debug?.(\`Invalid prefetch URL \${url}\`);
      return;
    }
    const controller = new AbortController();
    this.controllers.set(url, controller);
    this.concurrent += 1;
    const timeoutId = this.options.timeout > 0 ? setTimeout(() => controller.abort(), this.options.timeout) : void 0;
    try {
      const response = await fetch(parsedUrl.toString(), {
        method: "GET",
        signal: controller.signal,
        headers: { "X-Veryfront-Prefetch": "1" }
      });
      if (!response.ok) {
        return;
      }
      if (this.isResponseTooLarge(response)) {
        prefetchLogger.debug?.(\`Prefetch too large, skipping \${url}\`);
        return;
      }
      this.prefetchedUrls.add(url);
      if (this.onResourcesFetched) {
        try {
          await this.onResourcesFetched(response, url);
        } catch (callbackError) {
          prefetchLogger.error?.(\`Prefetch callback failed for \${url}\`, callbackError);
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        prefetchLogger.error?.(\`Failed to prefetch \${url}\`, error);
      }
    } finally {
      if (timeoutId !== void 0) {
        clearTimeout(timeoutId);
      }
      this.controllers.delete(url);
      this.concurrent = Math.max(0, this.concurrent - 1);
    }
  }
  async prefetch(url) {
    const link = typeof document !== "undefined" ? document.createElement("a") : { href: url };
    link.href = url;
    await this.prefetchLink(link);
  }
  stopAll() {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
    this.concurrent = 0;
  }
  isResponseTooLarge(response) {
    const rawLength = response.headers.get("content-length");
    if (rawLength === null) {
      return false;
    }
    const size = Number.parseInt(rawLength, 10);
    if (!Number.isFinite(size)) {
      return false;
    }
    return size > this.options.maxSize;
  }
};
var prefetchQueue = new PrefetchQueue();

// src/rendering/client/prefetch/resource-hints.ts
var ResourceHintsManager = class {
  constructor() {
    this.appliedHints = /* @__PURE__ */ new Set();
  }
  applyResourceHints(hints) {
    for (const hint of hints) {
      const key = \`\${hint.type}:\${hint.href}\`;
      if (this.appliedHints.has(key))
        continue;
      const existing = document.querySelector(\`link[rel="\${hint.type}"][href="\${hint.href}"]\`);
      if (existing) {
        this.appliedHints.add(key);
        continue;
      }
      this.createAndAppendHint(hint);
      this.appliedHints.add(key);
      prefetchLogger.debug(\`Added resource hint: \${hint.type} \${hint.href}\`);
    }
  }
  createAndAppendHint(hint) {
    if (!document.head) {
      prefetchLogger.warn("document.head is not available, skipping resource hint");
      return;
    }
    const link = document.createElement("link");
    link.rel = hint.type;
    link.href = hint.href;
    if (hint.as)
      link.setAttribute("as", hint.as);
    if (hint.crossOrigin)
      link.setAttribute("crossorigin", hint.crossOrigin);
    if (hint.media)
      link.setAttribute("media", hint.media);
    document.head.appendChild(link);
  }
  extractResourceHints(html, prefetchedUrls) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const hints = [];
      this.extractPreloadLinks(doc, prefetchedUrls, hints);
      this.extractScripts(doc, prefetchedUrls, hints);
      this.extractStylesheets(doc, prefetchedUrls, hints);
      return hints;
    } catch (error) {
      prefetchLogger.error("Failed to parse prefetched page", error);
      return [];
    }
  }
  isValidResourceHintType(rel) {
    return rel === "prefetch" || rel === "preload" || rel === "preconnect" || rel === "dns-prefetch";
  }
  extractPreloadLinks(doc, prefetchedUrls, hints) {
    doc.querySelectorAll('link[rel="preload"], link[rel="prefetch"]').forEach((link) => {
      const htmlLink = link;
      const href = htmlLink.href;
      if (href && !prefetchedUrls.has(href) && this.isValidResourceHintType(htmlLink.rel)) {
        hints.push({
          type: htmlLink.rel,
          href,
          as: htmlLink.getAttribute("as") || void 0
        });
      }
    });
  }
  extractScripts(doc, prefetchedUrls, hints) {
    doc.querySelectorAll("script[src]").forEach((script) => {
      const src = script.src;
      if (src && !prefetchedUrls.has(src)) {
        hints.push({ type: "prefetch", href: src, as: "script" });
      }
    });
  }
  extractStylesheets(doc, prefetchedUrls, hints) {
    doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      const href = link.href;
      if (href && !prefetchedUrls.has(href)) {
        hints.push({ type: "prefetch", href, as: "style" });
      }
    });
  }
  static generateResourceHints(_route, assets) {
    const hints = [
      '<link rel="dns-prefetch" href="https://cdn.jsdelivr.net">',
      '<link rel="dns-prefetch" href="https://esm.sh">',
      '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>'
    ];
    for (const asset of assets) {
      if (asset.endsWith(".js")) {
        hints.push(\`<link rel="modulepreload" href="\${asset}">\`);
      } else if (asset.endsWith(".css")) {
        hints.push(\`<link rel="preload" as="style" href="\${asset}">\`);
      } else if (asset.match(/\\.(woff2?|ttf|otf)\$/)) {
        hints.push(\`<link rel="preload" as="font" href="\${asset}" crossorigin>\`);
      }
    }
    return hints.join("\\n");
  }
};

// src/core/utils/runtime-guards.ts
function hasDenoRuntime(global) {
  return typeof global === "object" && global !== null && "Deno" in global && typeof global.Deno?.env?.get === "function";
}
function hasNodeProcess(global) {
  return typeof global === "object" && global !== null && "process" in global && typeof global.process?.env === "object";
}

// src/core/utils/logger/env.ts
function getEnvironmentVariable(name) {
  try {
    if (typeof Deno !== "undefined" && hasDenoRuntime(globalThis)) {
      const value = globalThis.Deno?.env.get(name);
      return value === "" ? void 0 : value;
    }
    if (hasNodeProcess(globalThis)) {
      const value = globalThis.process?.env[name];
      return value === "" ? void 0 : value;
    }
  } catch (error) {
    console.debug(\`Failed to get environment variable \${name}:\`, error);
    return void 0;
  }
  return void 0;
}

// src/core/utils/logger/logger.ts
var cachedLogLevel;
function resolveLogLevel(force = false) {
  if (force || cachedLogLevel === void 0) {
    cachedLogLevel = getDefaultLevel();
  }
  return cachedLogLevel;
}
var ConsoleLogger = class {
  constructor(prefix, level = resolveLogLevel()) {
    this.prefix = prefix;
    this.level = level;
  }
  setLevel(level) {
    this.level = level;
  }
  getLevel() {
    return this.level;
  }
  debug(message, ...args) {
    if (this.level <= 0 /* DEBUG */) {
      console.debug(\`[\${this.prefix}] DEBUG: \${message}\`, ...args);
    }
  }
  info(message, ...args) {
    if (this.level <= 1 /* INFO */) {
      console.log(\`[\${this.prefix}] \${message}\`, ...args);
    }
  }
  warn(message, ...args) {
    if (this.level <= 2 /* WARN */) {
      console.warn(\`[\${this.prefix}] WARN: \${message}\`, ...args);
    }
  }
  error(message, ...args) {
    if (this.level <= 3 /* ERROR */) {
      console.error(\`[\${this.prefix}] ERROR: \${message}\`, ...args);
    }
  }
  async time(label, fn) {
    const start = performance.now();
    try {
      const result = await fn();
      const end = performance.now();
      this.debug(\`\${label} completed in \${(end - start).toFixed(2)}ms\`);
      return result;
    } catch (_error) {
      const end = performance.now();
      this.error(\`\${label} failed after \${(end - start).toFixed(2)}ms\`, _error);
      throw _error;
    }
  }
};
function parseLogLevel(levelString) {
  if (!levelString)
    return void 0;
  const upper = levelString.toUpperCase();
  switch (upper) {
    case "DEBUG":
      return 0 /* DEBUG */;
    case "WARN":
      return 2 /* WARN */;
    case "ERROR":
      return 3 /* ERROR */;
    case "INFO":
      return 1 /* INFO */;
    default:
      return void 0;
  }
}
var getDefaultLevel = () => {
  const envLevel = getEnvironmentVariable("LOG_LEVEL");
  const parsedLevel = parseLogLevel(envLevel);
  if (parsedLevel !== void 0)
    return parsedLevel;
  const debugFlag = getEnvironmentVariable("VERYFRONT_DEBUG");
  if (debugFlag === "1" || debugFlag === "true")
    return 0 /* DEBUG */;
  return 1 /* INFO */;
};
var trackedLoggers = /* @__PURE__ */ new Set();
function createLogger(prefix) {
  const logger2 = new ConsoleLogger(prefix);
  trackedLoggers.add(logger2);
  return logger2;
}
var cliLogger = createLogger("CLI");
var serverLogger = createLogger("SERVER");
var rendererLogger = createLogger("RENDERER");
var bundlerLogger = createLogger("BUNDLER");
var agentLogger = createLogger("AGENT");
var logger = createLogger("VERYFRONT");

// deno.json
var deno_default = {
  name: "veryfront",
  version: "0.1.0",
  nodeModulesDir: "auto",
  workspace: [
    "./examples/async-worker-redis",
    "./examples/knowledge-base",
    "./examples/form-handling",
    "./examples/middleware-demo",
    "./examples/coding-agent",
    "./examples/durable-workflows"
  ],
  exports: {
    ".": "./src/index.ts",
    "./cli": "./src/cli/main.ts",
    "./server": "./src/server/index.ts",
    "./middleware": "./src/middleware/index.ts",
    "./components": "./src/react/components/index.ts",
    "./data": "./src/data/index.ts",
    "./config": "./src/core/config/index.ts",
    "./ai": "./src/ai/index.ts",
    "./ai/client": "./src/ai/client.ts",
    "./ai/react": "./src/ai/react/index.ts",
    "./ai/primitives": "./src/ai/react/primitives/index.ts",
    "./ai/components": "./src/ai/react/components/index.ts",
    "./ai/production": "./src/ai/production/index.ts",
    "./ai/dev": "./src/ai/dev/index.ts",
    "./ai/workflow": "./src/ai/workflow/index.ts",
    "./ai/workflow/react": "./src/ai/workflow/react/index.ts"
  },
  imports: {
    "@veryfront": "./src/index.ts",
    "@veryfront/": "./src/",
    "@veryfront/ai": "./src/ai/index.ts",
    "@veryfront/ai/": "./src/ai/",
    "@veryfront/platform": "./src/platform/index.ts",
    "@veryfront/platform/": "./src/platform/",
    "@veryfront/types": "./src/core/types/index.ts",
    "@veryfront/types/": "./src/core/types/",
    "@veryfront/utils": "./src/core/utils/index.ts",
    "@veryfront/utils/": "./src/core/utils/",
    "@veryfront/middleware": "./src/middleware/index.ts",
    "@veryfront/middleware/": "./src/middleware/",
    "@veryfront/errors": "./src/core/errors/index.ts",
    "@veryfront/errors/": "./src/core/errors/",
    "@veryfront/config": "./src/core/config/index.ts",
    "@veryfront/config/": "./src/core/config/",
    "@veryfront/observability": "./src/observability/index.ts",
    "@veryfront/observability/": "./src/observability/",
    "@veryfront/routing": "./src/routing/index.ts",
    "@veryfront/routing/": "./src/routing/",
    "@veryfront/transforms": "./src/build/transforms/index.ts",
    "@veryfront/transforms/": "./src/build/transforms/",
    "@veryfront/data": "./src/data/index.ts",
    "@veryfront/data/": "./src/data/",
    "@veryfront/security": "./src/security/index.ts",
    "@veryfront/security/": "./src/security/",
    "@veryfront/components": "./src/react/components/index.ts",
    "@veryfront/react": "./src/react/index.ts",
    "@veryfront/react/": "./src/react/",
    "@veryfront/html": "./src/html/index.ts",
    "@veryfront/html/": "./src/html/",
    "@veryfront/rendering": "./src/rendering/index.ts",
    "@veryfront/rendering/": "./src/rendering/",
    "@veryfront/build": "./src/build/index.ts",
    "@veryfront/build/": "./src/build/",
    "@veryfront/server": "./src/server/index.ts",
    "@veryfront/server/": "./src/server/",
    "@veryfront/modules": "./src/module-system/index.ts",
    "@veryfront/modules/": "./src/module-system/",
    "@veryfront/compat/console": "./src/platform/compat/console/index.ts",
    "@veryfront/compat/": "./src/platform/compat/",
    "std/": "https://deno.land/std@0.220.0/",
    "@std/path": "https://deno.land/std@0.220.0/path/mod.ts",
    "@std/testing/bdd.ts": "https://deno.land/std@0.220.0/testing/bdd.ts",
    "@std/expect": "https://deno.land/std@0.220.0/expect/mod.ts",
    csstype: "https://esm.sh/csstype@3.2.3",
    "@types/react": "https://esm.sh/@types/react@18.3.27?deps=csstype@3.2.3",
    "@types/react-dom": "https://esm.sh/@types/react-dom@18.3.7?deps=csstype@3.2.3",
    react: "https://esm.sh/react@18.3.1",
    "react-dom": "https://esm.sh/react-dom@18.3.1",
    "react-dom/server": "https://esm.sh/react-dom@18.3.1/server",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
    "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
    "react/jsx-dev-runtime": "https://esm.sh/react@18.3.1/jsx-dev-runtime",
    "@mdx-js/mdx": "https://esm.sh/@mdx-js/mdx@3.0.0?deps=react@18.3.1,react-dom@18.3.1",
    "@mdx-js/react": "https://esm.sh/@mdx-js/react@3.0.0?deps=react@18.3.1,react-dom@18.3.1",
    "unist-util-visit": "https://esm.sh/unist-util-visit@5.0.0",
    "mdast-util-to-string": "https://esm.sh/mdast-util-to-string@4.0.0",
    "github-slugger": "https://esm.sh/github-slugger@2.0.0",
    "remark-gfm": "https://esm.sh/remark-gfm@4.0.1",
    "remark-frontmatter": "https://esm.sh/remark-frontmatter@5.0.0",
    "rehype-highlight": "https://esm.sh/rehype-highlight@7.0.2",
    "rehype-slug": "https://esm.sh/rehype-slug@6.0.0",
    esbuild: "https://deno.land/x/esbuild@v0.20.1/wasm.js",
    "esbuild/mod.js": "https://deno.land/x/esbuild@v0.20.1/mod.js",
    zod: "https://esm.sh/zod@3.22.0",
    "mime-types": "https://esm.sh/mime-types@2.1.35",
    mdast: "https://esm.sh/@types/mdast@4.0.3",
    hast: "https://esm.sh/@types/hast@3.0.3",
    unist: "https://esm.sh/@types/unist@3.0.2",
    unified: "https://esm.sh/unified@11.0.5?dts",
    ai: "https://esm.sh/ai@5.0.76",
    "ai/react": "https://esm.sh/@ai-sdk/react@2.0.59",
    "@ai-sdk/openai": "https://esm.sh/@ai-sdk/openai@2.0.1",
    "@ai-sdk/anthropic": "https://esm.sh/@ai-sdk/anthropic@2.0.4",
    unocss: "https://esm.sh/unocss@0.59.0",
    "@unocss/core": "https://esm.sh/@unocss/core@0.59.0",
    "@unocss/preset-wind": "https://esm.sh/@unocss/preset-wind@0.59.0"
  },
  compilerOptions: {
    jsx: "react-jsx",
    jsxImportSource: "react",
    strict: true,
    noImplicitAny: true,
    noUncheckedIndexedAccess: true,
    types: [],
    lib: [
      "deno.window",
      "dom",
      "dom.iterable",
      "dom.asynciterable",
      "deno.ns"
    ]
  },
  tasks: {
    setup: "deno run --allow-all scripts/setup.ts",
    dev: "deno run --allow-all --no-lock --unstable-net --unstable-worker-options src/cli/main.ts dev",
    build: "deno compile --allow-all --output ../../bin/veryfront src/cli/main.ts",
    "build:npm": "deno run -A scripts/build-npm.ts",
    test: "DENO_JOBS=1 deno test --parallel --fail-fast --allow-all --unstable-worker-options --unstable-net",
    "test:unit": "DENO_JOBS=1 deno test --parallel --allow-all --v8-flags=--max-old-space-size=8192 --ignore=tests --unstable-worker-options --unstable-net",
    "test:integration": "DENO_JOBS=1 deno test --parallel --fail-fast --allow-all tests --unstable-worker-options --unstable-net",
    "test:batches": "deno run --allow-all scripts/test-batches.ts",
    "test:unsafe": "DENO_JOBS=1 deno test --parallel --fail-fast --allow-all --coverage=coverage --unstable-worker-options --unstable-net",
    "test:coverage": "rm -rf coverage && DENO_JOBS=1 deno test --parallel --fail-fast --allow-all --coverage=coverage --unstable-worker-options --unstable-net || exit 1",
    "test:coverage:unit": "rm -rf coverage && DENO_JOBS=1 deno test --parallel --fail-fast --allow-all --coverage=coverage --ignore=tests --unstable-worker-options --unstable-net || exit 1",
    "test:coverage:integration": "rm -rf coverage && DENO_JOBS=1 deno test --parallel --fail-fast --allow-all --coverage=coverage tests --unstable-worker-options --unstable-net || exit 1",
    "coverage:report": "deno coverage coverage --include=src/ --exclude=tests --exclude=src/**/*_test.ts --exclude=src/**/*_test.tsx --exclude=src/**/*.test.ts --exclude=src/**/*.test.tsx --lcov > coverage/lcov.info && deno run --allow-read scripts/check-coverage.ts 80",
    "coverage:html": "deno coverage coverage --include=src/ --exclude=tests --exclude=src/**/*_test.ts --exclude=src/**/*_test.tsx --exclude=src/**/*.test.ts --exclude=src/**/*.test.tsx --html",
    lint: "deno lint src/",
    fmt: "deno fmt src/",
    typecheck: "deno check src/index.ts src/cli/main.ts src/server/index.ts src/routing/api/index.ts src/rendering/index.ts src/platform/index.ts src/platform/adapters/index.ts src/build/index.ts src/build/production-build/index.ts src/build/transforms/index.ts src/core/config/index.ts src/core/utils/index.ts src/data/index.ts src/security/index.ts src/middleware/index.ts src/server/handlers/dev/index.ts src/server/handlers/request/api/index.ts src/rendering/cache/index.ts src/rendering/cache/stores/index.ts src/rendering/rsc/actions/index.ts src/html/index.ts src/module-system/index.ts",
    "docs:check-links": "deno run -A scripts/check-doc-links.ts",
    "lint:ban-console": "deno run --allow-read scripts/ban-console.ts",
    "lint:ban-deep-imports": "deno run --allow-read scripts/ban-deep-imports.ts",
    "lint:ban-internal-root-imports": "deno run --allow-read scripts/ban-internal-root-imports.ts",
    "lint:check-awaits": "deno run --allow-read scripts/check-unawaited-promises.ts",
    "check:circular": "deno run -A jsr:@cunarist/deno-circular-deps src/index.ts"
  },
  lint: {
    include: [
      "src/**/*.ts",
      "src/**/*.tsx"
    ],
    exclude: [
      "dist/",
      "coverage/"
    ],
    rules: {
      tags: [
        "recommended"
      ],
      include: [
        "ban-untagged-todo"
      ],
      exclude: [
        "no-explicit-any",
        "no-process-global",
        "no-console"
      ]
    }
  },
  fmt: {
    include: [
      "src/**/*.ts",
      "src/**/*.tsx"
    ],
    exclude: [
      "dist/",
      "coverage/"
    ],
    options: {
      useTabs: false,
      lineWidth: 100,
      indentWidth: 2,
      semiColons: true,
      singleQuote: false,
      proseWrap: "preserve"
    }
  }
};

// src/core/utils/version.ts
var VERSION = typeof deno_default.version === "string" ? deno_default.version : "0.0.0";

// src/core/utils/bundle-manifest.ts
var InMemoryBundleManifestStore = class {
  constructor() {
    this.metadata = /* @__PURE__ */ new Map();
    this.code = /* @__PURE__ */ new Map();
    this.sourceIndex = /* @__PURE__ */ new Map();
  }
  getBundleMetadata(key) {
    const entry = this.metadata.get(key);
    if (!entry)
      return Promise.resolve(void 0);
    if (entry.expiry && Date.now() > entry.expiry) {
      this.metadata.delete(key);
      return Promise.resolve(void 0);
    }
    return Promise.resolve(entry.value);
  }
  setBundleMetadata(key, metadata, ttlMs) {
    const expiry = ttlMs ? Date.now() + ttlMs : void 0;
    this.metadata.set(key, { value: metadata, expiry });
    if (!this.sourceIndex.has(metadata.source)) {
      this.sourceIndex.set(metadata.source, /* @__PURE__ */ new Set());
    }
    this.sourceIndex.get(metadata.source).add(key);
    return Promise.resolve();
  }
  getBundleCode(hash) {
    const entry = this.code.get(hash);
    if (!entry)
      return Promise.resolve(void 0);
    if (entry.expiry && Date.now() > entry.expiry) {
      this.code.delete(hash);
      return Promise.resolve(void 0);
    }
    return Promise.resolve(entry.value);
  }
  setBundleCode(hash, code, ttlMs) {
    const expiry = ttlMs ? Date.now() + ttlMs : void 0;
    this.code.set(hash, { value: code, expiry });
    return Promise.resolve();
  }
  async deleteBundle(key) {
    const metadata = await this.getBundleMetadata(key);
    this.metadata.delete(key);
    if (metadata) {
      this.code.delete(metadata.codeHash);
      const sourceKeys = this.sourceIndex.get(metadata.source);
      if (sourceKeys) {
        sourceKeys.delete(key);
        if (sourceKeys.size === 0) {
          this.sourceIndex.delete(metadata.source);
        }
      }
    }
  }
  async invalidateSource(source) {
    const keys = this.sourceIndex.get(source);
    if (!keys)
      return 0;
    let count = 0;
    for (const key of Array.from(keys)) {
      await this.deleteBundle(key);
      count++;
    }
    this.sourceIndex.delete(source);
    return count;
  }
  clear() {
    this.metadata.clear();
    this.code.clear();
    this.sourceIndex.clear();
    return Promise.resolve();
  }
  isAvailable() {
    return Promise.resolve(true);
  }
  getStats() {
    let totalSize = 0;
    let oldest;
    let newest;
    for (const { value } of this.metadata.values()) {
      totalSize += value.size;
      if (!oldest || value.compiledAt < oldest)
        oldest = value.compiledAt;
      if (!newest || value.compiledAt > newest)
        newest = value.compiledAt;
    }
    return Promise.resolve({
      totalBundles: this.metadata.size,
      totalSize,
      oldestBundle: oldest,
      newestBundle: newest
    });
  }
};
var manifestStore = new InMemoryBundleManifestStore();

// src/rendering/client/prefetch.ts
var PrefetchManager = class {
  constructor(options = {}) {
    this.prefetchedUrls = /* @__PURE__ */ new Set();
    this.linkObserver = null;
    this.options = {
      rootMargin: options.rootMargin || "50px",
      delay: options.delay || PREFETCH_DEFAULT_DELAY_MS,
      maxConcurrent: options.maxConcurrent || 2,
      allowedNetworks: options.allowedNetworks || ["4g", "wifi", "ethernet"],
      maxSize: options.maxSize || PREFETCH_MAX_SIZE_BYTES,
      timeout: options.timeout || PREFETCH_DEFAULT_TIMEOUT_MS
    };
    this.networkUtils = new NetworkUtils(this.options.allowedNetworks);
    this.resourceHintsManager = new ResourceHintsManager();
    this.prefetchQueue = new PrefetchQueue(
      {
        maxConcurrent: this.options.maxConcurrent,
        maxSize: this.options.maxSize,
        timeout: this.options.timeout
      },
      this.prefetchedUrls
    );
    this.prefetchQueue.setResourceCallback(
      (response, url) => this.prefetchPageResources(response, url)
    );
  }
  init() {
    prefetchLogger.info("Initializing prefetch manager");
    if (!this.networkUtils.shouldPrefetch()) {
      prefetchLogger.info("Prefetching disabled due to network conditions");
      return;
    }
    this.linkObserver = new LinkObserver(
      {
        rootMargin: this.options.rootMargin,
        delay: this.options.delay,
        onLinkVisible: (link) => this.prefetchQueue.prefetchLink(link)
      },
      this.prefetchedUrls
    );
    this.linkObserver.init();
    this.networkUtils.onNetworkChange(() => {
      if (!this.networkUtils.shouldPrefetch()) {
        this.prefetchQueue.stopAll();
      }
    });
  }
  async prefetchPageResources(response, _pageUrl) {
    const html = await response.text();
    const hints = this.resourceHintsManager.extractResourceHints(html, this.prefetchedUrls);
    this.resourceHintsManager.applyResourceHints(hints);
  }
  applyResourceHints(hints) {
    this.resourceHintsManager.applyResourceHints(hints);
  }
  async prefetch(url) {
    await this.prefetchQueue.prefetch(url);
  }
  static generateResourceHints(route, assets) {
    return ResourceHintsManager.generateResourceHints(route, assets);
  }
  destroy() {
    this.linkObserver?.destroy();
    this.prefetchQueue.stopAll();
    this.prefetchedUrls.clear();
  }
};
if (typeof window !== "undefined") {
  const prefetchManager = new PrefetchManager();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => prefetchManager.init());
  } else {
    prefetchManager.init();
  }
  globalThis.veryFrontPrefetch = prefetchManager;
}
export {
  PrefetchManager
};
`;
