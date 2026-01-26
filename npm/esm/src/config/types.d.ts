import * as dntShim from "../../_dnt.shims.js";
export interface VeryfrontConfig {
    projectSlug?: string;
    title?: string;
    description?: string;
    /** React configuration */
    react?: {
        /** React version to use (e.g., "18.3.1", "19.1.1"). Defaults to auto-detect from package.json or 19.1.1 */
        version?: string;
    };
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
    router?: "app" | "pages";
    /** Path to the layout component (e.g., 'components/layout.tsx'), or false to disable */
    layout?: string | false;
    /** Path to the app wrapper component (e.g., 'components/app.tsx'), or false to disable */
    app?: string | false;
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
        hmrPort?: number;
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
        /**
         * Authentication configuration (basic or bearer).
         * Prefer using config for auth to avoid env cross-test leakage.
         */
        auth?: {
            basic?: {
                username: string;
                password: string;
                realm?: string;
            };
            bearer?: {
                token: string;
            };
        };
        csp?: Partial<Record<string, string[]>>;
        remoteHosts?: string[];
        cors?: boolean | {
            origin?: string;
        };
        coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
        corp?: "same-origin" | "same-site" | "cross-origin";
        coep?: "require-corp" | "unsafe-none";
        /**
         * Restrict module imports to specific directories (opt-in security).
         * When not set, users can import from any directory in the project.
         * When set, only imports from these directories are allowed.
         * @example ["app", "pages", "components", "lib", "src", "utils"]
         */
        allowedImportDirs?: string[];
    };
    middleware?: {
        custom?: Array<(c: unknown, next: () => Promise<dntShim.Response | undefined> | dntShim.Response) => Promise<dntShim.Response | undefined> | dntShim.Response | undefined>;
    };
    theming?: {
        brandName?: string;
        logoHtml?: string;
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
        type?: "local" | "veryfront-api" | "memory" | "github";
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
            /** Production mode - fetch from releases instead of draft files */
            productionMode?: boolean;
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
        github?: {
            /** GitHub Personal Access Token */
            token: string;
            /** Repository owner (user or organization) */
            owner: string;
            /** Repository name */
            repo: string;
            /** Branch, tag, or commit SHA (default: "main") */
            ref?: string;
            cache?: {
                enabled?: boolean;
                ttl?: number;
                maxSize?: number;
                maxMemory?: number;
            };
            retry?: {
                maxRetries?: number;
                initialDelay?: number;
                maxDelay?: number;
            };
        };
    };
    ai?: {
        enabled?: boolean;
        providers?: Record<string, {
            apiKey?: string;
            baseURL?: string;
            defaultModel?: string;
            organization?: string;
        }>;
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
            versions?: "auto" | {
                react?: string;
                veryfront?: string;
            };
        };
    };
    /** CLI generate command preferences */
    generate?: {
        /** Preferred router for generated pages */
        preferredRouter?: "app-router" | "pages-router";
    };
    tailwind?: {
        /** Path to the global stylesheet (default: "globals.css") */
        stylesheet?: string;
        /** Enable built-in Tailwind CDN plugins (forms, typography, aspect-ratio, container-queries) */
        plugins?: Array<"forms" | "typography" | "aspect-ratio" | "container-queries">;
        /** Extend the Tailwind theme (merged with veryfront defaults) */
        theme?: {
            extend?: {
                colors?: Record<string, string | Record<string, string>>;
                fontFamily?: Record<string, string[]>;
                spacing?: Record<string, string>;
                fontSize?: Record<string, string | [string, {
                    lineHeight?: string;
                    letterSpacing?: string;
                }]>;
                screens?: Record<string, string>;
                animation?: Record<string, string>;
                keyframes?: Record<string, Record<string, Record<string, string>>>;
                [key: string]: unknown;
            };
        };
        /** Custom CSS content to add (for @layer, @apply directives, etc.) */
        customCSS?: string;
    };
    /** Semantic search configuration */
    search?: {
        /** Enable semantic search indexing (default: false) */
        enabled?: boolean;
        /** Embedding provider configuration */
        embedding?: {
            /** Provider name (openai, cohere, voyageai, or custom) */
            provider?: "openai" | "cohere" | "voyageai" | "custom";
            /** Model name (e.g., text-embedding-3-small) */
            model?: string;
            /** Vector dimension (768, 1024, 1536, 3072, 4096) */
            dimension?: 768 | 1024 | 1536 | 3072 | 4096;
            /** API key (can also use env var) */
            apiKey?: string;
            /** Batch size for embedding requests (default: 100) */
            batchSize?: number;
        };
        /** Chunking configuration */
        chunking?: {
            /** Max tokens per chunk (default: 500) */
            maxTokens?: number;
            /** Overlap tokens between chunks (default: 50) */
            overlapTokens?: number;
            /** File patterns to index */
            include?: string[];
            /** File patterns to exclude */
            exclude?: string[];
        };
        /** Auto-index on file changes (default: false in dev, true in production) */
        autoIndex?: boolean;
    };
    /** OpenAPI documentation configuration */
    openapi?: {
        /** Enable OpenAPI endpoint (default: true) */
        enabled?: boolean;
        /** Enable interactive docs page using Scalar (default: true) */
        docs?: boolean;
        /** API title for OpenAPI info section */
        title?: string;
        /** API version (default: "1.0.0") */
        version?: string;
        /** API description */
        description?: string;
        /** Custom path configuration */
        paths?: {
            /** Path for JSON spec (default: "/_openapi.json") */
            json?: string;
            /** Path for YAML spec (default: "/_openapi.yaml") */
            yaml?: string;
            /** Path for interactive docs (default: "/_docs") */
            docs?: string;
        };
        /** MCP integration configuration */
        mcp?: {
            /** Expose OpenAPI spec as MCP resource at openapi://spec (default: true) */
            resource?: boolean;
            /** Auto-generate MCP tools from API routes (default: true) */
            tools?: boolean;
            /** Tool naming prefix (default: "api") - tools named as prefix:operationId */
            toolPrefix?: string;
        };
    };
}
//# sourceMappingURL=types.d.ts.map