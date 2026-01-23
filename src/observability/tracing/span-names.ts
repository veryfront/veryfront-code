export const SpanNames = {
  // HTTP layer
  HTTP_REQUEST: "http.request",
  HTTP_HANDLER: "http.handler",

  // Rendering pipeline
  RENDER_PAGE: "render.page",
  RENDER_COMPONENT: "render.component",
  RENDER_LAYOUT: "render.layout",
  RENDER_SSR: "render.ssr",
  RENDER_RSC: "render.rsc",
  RENDER_LOAD_MODULES: "render.load_modules",
  RENDER_FETCH_DATA: "render.fetch_data",

  // Data operations
  DATA_FETCH: "data.fetch",
  DATA_CACHE_GET: "data.cache.get",
  DATA_CACHE_SET: "data.cache.set",

  // Cache operations
  CACHE_CHECK_SPECULATIVE: "cache.check_speculative",

  // Build pipeline
  BUILD_BUNDLE: "build.bundle",
  BUILD_SPLIT: "build.split",
  BUILD_OPTIMIZE: "build.optimize",
  BUILD_COMPILE: "build.compile",

  // RSC (React Server Components)
  RSC_RENDER: "rsc.render",
  RSC_SERIALIZE: "rsc.serialize",
  RSC_STREAM: "rsc.stream",

  // Router
  ROUTER_MATCH: "router.match",
  ROUTER_RESOLVE: "router.resolve",

  // Config loading
  CONFIG_LOAD: "config.load",
  CONFIG_LOAD_PROJECT: "config.load_project",
  CONFIG_TRANSPILE: "config.transpile",

  // Layout collection
  LAYOUT_COLLECT: "layout.collect",
  LAYOUT_COLLECT_NAMED: "layout.collect_named",
  LAYOUT_COLLECT_NESTED: "layout.collect_nested",
  LAYOUT_GET_ENTITY: "layout.get_entity",

  // MDX compilation
  MDX_COMPILE: "mdx.compile",
  MDX_CACHE_GET: "mdx.cache.get",
  MDX_CACHE_SET: "mdx.cache.set",

  // API operations
  API_REQUEST: "api.request",
  API_GET_FILE: "api.get_file",
  API_LIST_FILES: "api.list_files",
  API_GET_PROJECT: "api.get_project",
  API_DOMAIN_LOOKUP: "api.domain_lookup",

  // Domain lookup
  DOMAIN_LOOKUP: "domain.lookup",
  DOMAIN_RELEASE_LOOKUP: "domain.release_lookup",

  // Handler execution
  HANDLER_EXECUTE: "handler.execute",
  HANDLER_REGISTRY: "handler.registry",

  // Module serving
  MODULE_SERVE: "module.serve",
  MODULE_TRANSFORM: "module.transform",

  // Static file serving
  STATIC_SERVE: "static.serve",

  // SSR Module Loader
  SSR_LOAD_MODULE: "ssr.load_module",
  SSR_TRANSFORM_DEPENDENCIES: "ssr.transform_dependencies",
  SSR_TRANSFORM_SINGLE: "ssr.transform_single",
  SSR_DYNAMIC_IMPORT: "ssr.dynamic_import",
  SSR_WAIT_IN_PROGRESS: "ssr.wait_in_progress",

  // MDX ESM Loading
  MDX_LOAD_MODULE_ESM: "mdx.load_module_esm",
  MDX_PROCESS_VF_MODULES: "mdx.process_vf_modules",
  MDX_TRANSFORM_JSX: "mdx.transform_jsx",
  MDX_CACHE_HTTP: "mdx.cache_http",
  MDX_DYNAMIC_IMPORT: "mdx.dynamic_import",
} as const;
