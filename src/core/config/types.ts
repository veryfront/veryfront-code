export interface VeryfrontConfig {
  title?: string;
  description?: string;
  directories?: {
    app?: string;
    pages?: string;
    components?: string[];
    ai?: string;
  };
  experimental?: {
    esmLayouts?: boolean;
    precompileMDX?: boolean;
    rsc?: boolean;
  };
  router?: "app" | "pages" | undefined;
  defaultLayout?: string | undefined;
  /** Path to the root layout component (e.g., 'components/layout.tsx') */
  layout?: string;
  /** Path to the app provider component for global context (e.g., 'components/providers.tsx') */
  provider?: string;
  /** Path to the app wrapper component (e.g., 'components/app.tsx') */
  app?: string;
  theme?: {
    colors?: Record<string, string>;
  };
  build?: {
    outDir?: string;
    trailingSlash?: boolean;
    esbuild?: {
      wasmURL?: string;
      worker?: boolean;
    };
  };
  cache?: {
    dir?: string;
    bundleManifest?: {
      type?: "redis" | "kv" | "memory";
      redisUrl?: string;
      keyPrefix?: string;
      ttl?: number;
      enabled?: boolean;
    };
    render?: {
      type?: "memory" | "filesystem" | "kv" | "redis";
      ttl?: number;
      maxEntries?: number;
      kvPath?: string;
      redisUrl?: string;
      redisKeyPrefix?: string;
    };
  };
  dev?: {
    port?: number;
    host?: string;
    open?: boolean;
    hmr?: boolean;
    components?: string[];
    moduleServerUrl?: string;
  };
  resolve?: {
    importMap?: {
      imports?: Record<string, string>;
      scopes?: Record<string, Record<string, string>>;
    };
  };
  security?: {
    csp?: Partial<Record<string, string[]>>;
    remoteHosts?: string[];
    cors?: boolean | { origin?: string };
    coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
    corp?: "same-origin" | "same-site" | "cross-origin";
    coep?: "require-corp" | "unsafe-none";
  };
  middleware?: {
    custom?: Array<
      (
        c: unknown,
        next: () => Promise<Response | undefined> | Response,
      ) => Promise<Response | undefined> | Response | undefined
    >;
  };
  theming?: {
    brandName?: string; // shown on default 404/500
    logoHtml?: string; // small HTML snippet injected into the footer area
  };
  assetPipeline?: {
    images?: {
      enabled?: boolean;
      formats?: Array<"webp" | "avif" | "jpeg" | "png">;
      sizes?: number[];
      quality?: number;
      inputDir?: string;
      outputDir?: string;
      preserveOriginal?: boolean;
    };
    css?: {
      enabled?: boolean;
      minify?: boolean;
      autoprefixer?: boolean;
      purge?: boolean;
      criticalCSS?: boolean;
      inputDir?: string;
      outputDir?: string;
      browsers?: string[];
      purgeContent?: string[];
      sourceMap?: boolean;
    };
  };
  observability?: {
    tracing?: {
      enabled?: boolean;
      exporter?: "jaeger" | "zipkin" | "otlp" | "console";
      endpoint?: string;
      serviceName?: string;
      sampleRate?: number;
    };
    metrics?: {
      enabled?: boolean;
      exporter?: "prometheus" | "otlp" | "console";
      endpoint?: string;
      prefix?: string;
      collectInterval?: number;
    };
  };
  fs?: {
    type?: "local" | "veryfront-api" | "memory";
    local?: {
      baseDir?: string;
    };
    veryfront?: {
      apiBaseUrl: string;
      /** API token - optional in proxy mode (token provided per-request via headers) */
      apiToken?: string;
      /** Project slug - optional in proxy mode (slug provided per-request via headers) */
      projectSlug?: string;
      /** Enable proxy mode for multi-project handling (tokens/slugs from headers) */
      proxyMode?: boolean;
      cache?: {
        enabled?: boolean;
        ttl?: number;
        maxSize?: number;
      };
      retry?: {
        maxRetries?: number;
        initialDelay?: number;
        maxDelay?: number;
      };
    };
    memory?: {
      files?: Record<string, string | Uint8Array>;
    };
  };
  ai?: {
    enabled?: boolean;
    providers?: Record<
      string,
      { apiKey?: string; baseURL?: string; defaultModel?: string; organization?: string }
    >;
    tools?: {
      discovery?: {
        enabled?: boolean;
        paths?: string[];
      };
    };
    agents?: {
      discovery?: {
        enabled?: boolean;
        paths?: string[];
      };
    };
    mcp?: {
      enabled?: boolean;
      port?: number;
      expose?: string[];
    };
  };
  client?: {
    /** How to resolve veryfront client modules in browser */
    moduleResolution?: "cdn" | "self-hosted" | "bundled";
    /** CDN options when moduleResolution is 'cdn' */
    cdn?: {
      provider?: "esm.sh" | "unpkg" | "jsdelivr";
      /** 'auto' detects from package.json, or pin specific versions */
      versions?: "auto" | { react?: string; veryfront?: string };
    };
  };
  tailwind?: {
    /** Enable built-in Tailwind CDN plugins (forms, typography, aspect-ratio, container-queries) */
    plugins?: Array<"forms" | "typography" | "aspect-ratio" | "container-queries">;
    /** Extend the Tailwind theme (merged with veryfront defaults) */
    theme?: {
      extend?: {
        colors?: Record<string, string | Record<string, string>>;
        fontFamily?: Record<string, string[]>;
        spacing?: Record<string, string>;
        fontSize?: Record<
          string,
          string | [string, { lineHeight?: string; letterSpacing?: string }]
        >;
        screens?: Record<string, string>;
        animation?: Record<string, string>;
        keyframes?: Record<string, Record<string, Record<string, string>>>;
        [key: string]: unknown;
      };
    };
    /** Custom CSS content to add (for @layer, @apply directives, etc.) */
    customCSS?: string;
  };
}
