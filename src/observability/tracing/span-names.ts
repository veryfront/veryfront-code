export const SpanNames = {
  HTTP_REQUEST: "http.request",
  HTTP_HANDLER: "http.handler",
  HTTP_CLIENT_FETCH: "http.client.fetch",

  RENDER_PAGE: "render.page",
  RENDER_COMPONENT: "render.component",
  RENDER_LAYOUT: "render.layout",
  RENDER_SSR: "render.ssr",
  RENDER_RSC: "render.rsc",
  RENDER_LOAD_MODULES: "render.load_modules",
  RENDER_FETCH_DATA: "render.fetch_data",

  DATA_FETCH: "data.fetch",
  DATA_CACHE_GET: "data.cache.get",
  DATA_CACHE_SET: "data.cache.set",
  DATA_FETCH_STATIC_PATHS: "data.fetch_static_paths",

  CACHE_CHECK_SPECULATIVE: "cache.check_speculative",

  BUILD_BUNDLE: "build.bundle",
  BUILD_SPLIT: "build.split",
  BUILD_OPTIMIZE: "build.optimize",
  BUILD_COMPILE: "build.compile",

  RSC_RENDER: "rsc.render",
  RSC_SERIALIZE: "rsc.serialize",
  RSC_STREAM: "rsc.stream",

  ROUTER_MATCH: "router.match",
  ROUTER_RESOLVE: "router.resolve",
  ROUTER_DETECT_APP: "router.detect_app",

  CONFIG_LOAD: "config.load",
  CONFIG_LOAD_PROJECT: "config.load_project",
  CONFIG_TRANSPILE: "config.transpile",

  LAYOUT_COLLECT: "layout.collect",
  LAYOUT_COLLECT_NAMED: "layout.collect_named",
  LAYOUT_COLLECT_NESTED: "layout.collect_nested",
  LAYOUT_GET_ENTITY: "layout.get_entity",

  LAYOUT_APPLY: "layout.apply",
  LAYOUT_APPLY_ONLY: "layout.apply_only",
  LAYOUT_APPLY_LAYOUTS_ESM: "layout.apply_layouts_esm",
  LAYOUT_APPLY_MDX: "layout.apply_mdx",
  LAYOUT_APPLY_TSX: "layout.apply_tsx",
  LAYOUT_LOAD_MDX: "layout.load_mdx",
  LAYOUT_WRAP_APP_COMPONENT: "layout.wrap_app_component",
  LAYOUT_WRAP_RESERVED: "layout.wrap_reserved",

  MDX_COMPILE: "mdx.compile",
  MDX_CACHE_GET: "mdx.cache.get",
  MDX_CACHE_SET: "mdx.cache.set",
  MDX_LOAD_MODULE_ESM: "mdx.load_module_esm",
  MDX_PROCESS_VF_MODULES: "mdx.process_vf_modules",
  MDX_FETCH_MODULE: "mdx.fetch_module",
  MDX_TRANSFORM_JSX: "mdx.transform_jsx",
  MDX_CACHE_HTTP: "mdx.cache_http",
  MDX_DYNAMIC_IMPORT: "mdx.dynamic_import",

  API_REQUEST: "api.request",
  API_GET_FILE: "api.get_file",
  API_LIST_FILES: "api.list_files",
  API_GET_PROJECT: "api.get_project",
  API_DOMAIN_LOOKUP: "api.domain_lookup",

  DOMAIN_LOOKUP: "domain.lookup",
  DOMAIN_RELEASE_LOOKUP: "domain.release_lookup",

  HANDLER_EXECUTE: "handler.execute",
  HANDLER_REGISTRY: "handler.registry",

  MODULE_SERVE: "module.serve",
  MODULE_TRANSFORM: "module.transform",

  STATIC_SERVE: "static.serve",

  SSR_LOAD_MODULE: "ssr.load_module",
  SSR_TRANSFORM_DEPENDENCIES: "ssr.transform_dependencies",
  SSR_TRANSFORM_SINGLE: "ssr.transform_single",
  SSR_DYNAMIC_IMPORT: "ssr.dynamic_import",
  SSR_WAIT_IN_PROGRESS: "ssr.wait_in_progress",

  SSR_REACT_RENDER: "ssr.react_render",
  SSR_REACT_RENDER_TO_STRING: "ssr.react_render_to_string",
  SSR_REACT_RENDER_TO_STREAM: "ssr.react_render_to_stream",
  SSR_ORCHESTRATOR_RENDER: "ssr.orchestrator_render",
  SSR_HTML_GENERATE: "ssr.html_generate",
  SSR_CONTENT_HASH: "ssr.content_hash",
  SSR_STREAM_CONVERT: "ssr.stream_convert",

  CACHE_DISTRIBUTED_INIT: "cache.distributed.init",
  CACHE_BACKEND_CREATE: "cache.backend.create",
  CACHE_REDIS_INIT: "cache.redis.init",
  CACHE_REGISTRY_SCAN_REDIS: "cache.registry.scan_redis",
  CACHE_REGISTRY_GET_REDIS_KEYS: "cache.registry.get_redis_keys",
  CACHE_REGISTRY_DELETE_REDIS_KEYS: "cache.registry.delete_redis_keys",
  CACHE_KEYS_GET_ALL_ASYNC: "cache.keys.get_all_async",
  CACHE_KEYS_DELETE_ALL_ASYNC: "cache.keys.delete_all_async",

  HTML_GENERATE_SHELL_PARTS: "html.generate_shell_parts",
  HTML_WRAP_IN_SHELL: "html.wrap_in_shell",
  HTML_GENERATE_TAILWIND_CSS: "html.generate_tailwind_css",
  HTML_GET_CSS_BY_HASH: "html.get_css_by_hash",
  HTML_REGENERATE_CSS_BY_HASH: "html.regenerate_css_by_hash",

  SHARED_SERVICES_INIT: "shared.services.init",
} as const;
