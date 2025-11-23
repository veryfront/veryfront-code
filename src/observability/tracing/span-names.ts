export const SpanNames = {
  HTTP_REQUEST: "http.request",
  HTTP_HANDLER: "http.handler",

  RENDER_PAGE: "render.page",
  RENDER_COMPONENT: "render.component",
  RENDER_LAYOUT: "render.layout",
  RENDER_SSR: "render.ssr",
  RENDER_RSC: "render.rsc",

  DATA_FETCH: "data.fetch",
  DATA_CACHE_GET: "data.cache.get",
  DATA_CACHE_SET: "data.cache.set",

  BUILD_BUNDLE: "build.bundle",
  BUILD_SPLIT: "build.split",
  BUILD_OPTIMIZE: "build.optimize",
  BUILD_COMPILE: "build.compile",

  RSC_RENDER: "rsc.render",
  RSC_SERIALIZE: "rsc.serialize",
  RSC_STREAM: "rsc.stream",

  ROUTER_MATCH: "router.match",
  ROUTER_RESOLVE: "router.resolve",
} as const;
