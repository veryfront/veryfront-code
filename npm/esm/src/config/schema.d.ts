import { z } from "zod";
import type { VeryfrontConfig } from "./types.js";
export declare const veryfrontConfigSchema: z.ZodObject<{
    projectSlug: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    title: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    react: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        version: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        version?: string | undefined;
    }, {
        version?: string | undefined;
    }>>>;
    experimental: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        esmLayouts: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        precompileMDX: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        rsc: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        esmLayouts?: boolean | undefined;
        precompileMDX?: boolean | undefined;
        rsc?: boolean | undefined;
    }, {
        esmLayouts?: boolean | undefined;
        precompileMDX?: boolean | undefined;
        rsc?: boolean | undefined;
    }>>>;
    router: z.ZodOptional<z.ZodOptional<z.ZodEnum<["app", "pages"]>>>;
    layout: z.ZodOptional<z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodLiteral<false>]>>>;
    app: z.ZodOptional<z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodLiteral<false>]>>>;
    theme: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        colors: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>>;
    }, "strip", z.ZodTypeAny, {
        colors?: Record<string, string> | undefined;
    }, {
        colors?: Record<string, string> | undefined;
    }>>>;
    build: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        outDir: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        trailingSlash: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        esbuild: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            wasmURL: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            worker: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        }, "strip", z.ZodTypeAny, {
            wasmURL?: string | undefined;
            worker?: boolean | undefined;
        }, {
            wasmURL?: string | undefined;
            worker?: boolean | undefined;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        outDir?: string | undefined;
        trailingSlash?: boolean | undefined;
        esbuild?: {
            wasmURL?: string | undefined;
            worker?: boolean | undefined;
        } | undefined;
    }, {
        outDir?: string | undefined;
        trailingSlash?: boolean | undefined;
        esbuild?: {
            wasmURL?: string | undefined;
            worker?: boolean | undefined;
        } | undefined;
    }>>>;
    cache: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        dir: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        bundleManifest: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            type: z.ZodOptional<z.ZodOptional<z.ZodEnum<["redis", "kv", "memory"]>>>;
            redisUrl: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            keyPrefix: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            ttl: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            enabled: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        }, "strip", z.ZodTypeAny, {
            type?: "memory" | "redis" | "kv" | undefined;
            redisUrl?: string | undefined;
            keyPrefix?: string | undefined;
            ttl?: number | undefined;
            enabled?: boolean | undefined;
        }, {
            type?: "memory" | "redis" | "kv" | undefined;
            redisUrl?: string | undefined;
            keyPrefix?: string | undefined;
            ttl?: number | undefined;
            enabled?: boolean | undefined;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        dir?: string | undefined;
        bundleManifest?: {
            type?: "memory" | "redis" | "kv" | undefined;
            redisUrl?: string | undefined;
            keyPrefix?: string | undefined;
            ttl?: number | undefined;
            enabled?: boolean | undefined;
        } | undefined;
    }, {
        dir?: string | undefined;
        bundleManifest?: {
            type?: "memory" | "redis" | "kv" | undefined;
            redisUrl?: string | undefined;
            keyPrefix?: string | undefined;
            ttl?: number | undefined;
            enabled?: boolean | undefined;
        } | undefined;
    }>>>;
    dev: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        port: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        host: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        open: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        hmr: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        components: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    }, "strip", z.ZodTypeAny, {
        open?: boolean | undefined;
        host?: string | undefined;
        port?: number | undefined;
        hmr?: boolean | undefined;
        components?: string[] | undefined;
    }, {
        open?: boolean | undefined;
        host?: string | undefined;
        port?: number | undefined;
        hmr?: boolean | undefined;
        components?: string[] | undefined;
    }>>>;
    resolve: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        importMap: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            imports: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>>;
            scopes: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodString>>>>;
        }, "strip", z.ZodTypeAny, {
            imports?: Record<string, string> | undefined;
            scopes?: Record<string, Record<string, string>> | undefined;
        }, {
            imports?: Record<string, string> | undefined;
            scopes?: Record<string, Record<string, string>> | undefined;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        importMap?: {
            imports?: Record<string, string> | undefined;
            scopes?: Record<string, Record<string, string>> | undefined;
        } | undefined;
    }, {
        importMap?: {
            imports?: Record<string, string> | undefined;
            scopes?: Record<string, Record<string, string>> | undefined;
        } | undefined;
    }>>>;
    security: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        auth: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            basic: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                username: z.ZodString;
                password: z.ZodString;
                realm: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                password: string;
                username: string;
                realm?: string | undefined;
            }, {
                password: string;
                username: string;
                realm?: string | undefined;
            }>>>;
            bearer: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                token: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                token: string;
            }, {
                token: string;
            }>>>;
        }, "strip", z.ZodTypeAny, {
            basic?: {
                password: string;
                username: string;
                realm?: string | undefined;
            } | undefined;
            bearer?: {
                token: string;
            } | undefined;
        }, {
            basic?: {
                password: string;
                username: string;
                realm?: string | undefined;
            } | undefined;
            bearer?: {
                token: string;
            } | undefined;
        }>>>;
        csp: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>>>;
        remoteHosts: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        cors: z.ZodOptional<z.ZodOptional<z.ZodUnion<[z.ZodBoolean, z.ZodObject<{
            origin: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            origin?: string | undefined;
        }, {
            origin?: string | undefined;
        }>]>>>;
        coop: z.ZodOptional<z.ZodOptional<z.ZodEnum<["same-origin", "same-origin-allow-popups", "unsafe-none"]>>>;
        corp: z.ZodOptional<z.ZodOptional<z.ZodEnum<["same-origin", "same-site", "cross-origin"]>>>;
        coep: z.ZodOptional<z.ZodOptional<z.ZodEnum<["require-corp", "unsafe-none"]>>>;
    }, "strip", z.ZodTypeAny, {
        auth?: {
            basic?: {
                password: string;
                username: string;
                realm?: string | undefined;
            } | undefined;
            bearer?: {
                token: string;
            } | undefined;
        } | undefined;
        csp?: Record<string, string[]> | undefined;
        remoteHosts?: string[] | undefined;
        cors?: boolean | {
            origin?: string | undefined;
        } | undefined;
        coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none" | undefined;
        corp?: "same-origin" | "same-site" | "cross-origin" | undefined;
        coep?: "unsafe-none" | "require-corp" | undefined;
    }, {
        auth?: {
            basic?: {
                password: string;
                username: string;
                realm?: string | undefined;
            } | undefined;
            bearer?: {
                token: string;
            } | undefined;
        } | undefined;
        csp?: Record<string, string[]> | undefined;
        remoteHosts?: string[] | undefined;
        cors?: boolean | {
            origin?: string | undefined;
        } | undefined;
        coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none" | undefined;
        corp?: "same-origin" | "same-site" | "cross-origin" | undefined;
        coep?: "unsafe-none" | "require-corp" | undefined;
    }>>>;
    middleware: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        custom: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodFunction<z.ZodTuple<[], z.ZodUnknown>, z.ZodUnknown>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        custom?: ((...args: unknown[]) => unknown)[] | undefined;
    }, {
        custom?: ((...args: unknown[]) => unknown)[] | undefined;
    }>>>;
    theming: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        brandName: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        logoHtml: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        brandName?: string | undefined;
        logoHtml?: string | undefined;
    }, {
        brandName?: string | undefined;
        logoHtml?: string | undefined;
    }>>>;
    assetPipeline: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        images: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            formats: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodEnum<["webp", "avif", "jpeg", "png"]>, "many">>>;
            sizes: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>>;
            quality: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            inputDir: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            outputDir: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            preserveOriginal: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        }, "strip", z.ZodTypeAny, {
            enabled?: boolean | undefined;
            formats?: ("webp" | "avif" | "jpeg" | "png")[] | undefined;
            sizes?: number[] | undefined;
            quality?: number | undefined;
            inputDir?: string | undefined;
            outputDir?: string | undefined;
            preserveOriginal?: boolean | undefined;
        }, {
            enabled?: boolean | undefined;
            formats?: ("webp" | "avif" | "jpeg" | "png")[] | undefined;
            sizes?: number[] | undefined;
            quality?: number | undefined;
            inputDir?: string | undefined;
            outputDir?: string | undefined;
            preserveOriginal?: boolean | undefined;
        }>>>;
        css: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            minify: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            autoprefixer: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            purge: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            criticalCSS: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            inputDir: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            outputDir: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            browsers: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            purgeContent: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            sourceMap: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        }, "strip", z.ZodTypeAny, {
            enabled?: boolean | undefined;
            inputDir?: string | undefined;
            outputDir?: string | undefined;
            minify?: boolean | undefined;
            autoprefixer?: boolean | undefined;
            purge?: boolean | undefined;
            criticalCSS?: boolean | undefined;
            browsers?: string[] | undefined;
            purgeContent?: string[] | undefined;
            sourceMap?: boolean | undefined;
        }, {
            enabled?: boolean | undefined;
            inputDir?: string | undefined;
            outputDir?: string | undefined;
            minify?: boolean | undefined;
            autoprefixer?: boolean | undefined;
            purge?: boolean | undefined;
            criticalCSS?: boolean | undefined;
            browsers?: string[] | undefined;
            purgeContent?: string[] | undefined;
            sourceMap?: boolean | undefined;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        css?: {
            enabled?: boolean | undefined;
            inputDir?: string | undefined;
            outputDir?: string | undefined;
            minify?: boolean | undefined;
            autoprefixer?: boolean | undefined;
            purge?: boolean | undefined;
            criticalCSS?: boolean | undefined;
            browsers?: string[] | undefined;
            purgeContent?: string[] | undefined;
            sourceMap?: boolean | undefined;
        } | undefined;
        images?: {
            enabled?: boolean | undefined;
            formats?: ("webp" | "avif" | "jpeg" | "png")[] | undefined;
            sizes?: number[] | undefined;
            quality?: number | undefined;
            inputDir?: string | undefined;
            outputDir?: string | undefined;
            preserveOriginal?: boolean | undefined;
        } | undefined;
    }, {
        css?: {
            enabled?: boolean | undefined;
            inputDir?: string | undefined;
            outputDir?: string | undefined;
            minify?: boolean | undefined;
            autoprefixer?: boolean | undefined;
            purge?: boolean | undefined;
            criticalCSS?: boolean | undefined;
            browsers?: string[] | undefined;
            purgeContent?: string[] | undefined;
            sourceMap?: boolean | undefined;
        } | undefined;
        images?: {
            enabled?: boolean | undefined;
            formats?: ("webp" | "avif" | "jpeg" | "png")[] | undefined;
            sizes?: number[] | undefined;
            quality?: number | undefined;
            inputDir?: string | undefined;
            outputDir?: string | undefined;
            preserveOriginal?: boolean | undefined;
        } | undefined;
    }>>>;
    observability: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        tracing: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            exporter: z.ZodOptional<z.ZodOptional<z.ZodEnum<["jaeger", "zipkin", "otlp", "console"]>>>;
            endpoint: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            serviceName: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            sampleRate: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        }, "strip", z.ZodTypeAny, {
            endpoint?: string | undefined;
            enabled?: boolean | undefined;
            exporter?: "console" | "jaeger" | "zipkin" | "otlp" | undefined;
            serviceName?: string | undefined;
            sampleRate?: number | undefined;
        }, {
            endpoint?: string | undefined;
            enabled?: boolean | undefined;
            exporter?: "console" | "jaeger" | "zipkin" | "otlp" | undefined;
            serviceName?: string | undefined;
            sampleRate?: number | undefined;
        }>>>;
        metrics: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            exporter: z.ZodOptional<z.ZodOptional<z.ZodEnum<["prometheus", "otlp", "console"]>>>;
            endpoint: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            prefix: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            collectInterval: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        }, "strip", z.ZodTypeAny, {
            endpoint?: string | undefined;
            enabled?: boolean | undefined;
            exporter?: "console" | "otlp" | "prometheus" | undefined;
            prefix?: string | undefined;
            collectInterval?: number | undefined;
        }, {
            endpoint?: string | undefined;
            enabled?: boolean | undefined;
            exporter?: "console" | "otlp" | "prometheus" | undefined;
            prefix?: string | undefined;
            collectInterval?: number | undefined;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        tracing?: {
            endpoint?: string | undefined;
            enabled?: boolean | undefined;
            exporter?: "console" | "jaeger" | "zipkin" | "otlp" | undefined;
            serviceName?: string | undefined;
            sampleRate?: number | undefined;
        } | undefined;
        metrics?: {
            endpoint?: string | undefined;
            enabled?: boolean | undefined;
            exporter?: "console" | "otlp" | "prometheus" | undefined;
            prefix?: string | undefined;
            collectInterval?: number | undefined;
        } | undefined;
    }, {
        tracing?: {
            endpoint?: string | undefined;
            enabled?: boolean | undefined;
            exporter?: "console" | "jaeger" | "zipkin" | "otlp" | undefined;
            serviceName?: string | undefined;
            sampleRate?: number | undefined;
        } | undefined;
        metrics?: {
            endpoint?: string | undefined;
            enabled?: boolean | undefined;
            exporter?: "console" | "otlp" | "prometheus" | undefined;
            prefix?: string | undefined;
            collectInterval?: number | undefined;
        } | undefined;
    }>>>;
    search: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        embedding: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            provider: z.ZodOptional<z.ZodOptional<z.ZodEnum<["openai", "cohere", "voyageai", "custom"]>>>;
            model: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            dimension: z.ZodOptional<z.ZodOptional<z.ZodUnion<[z.ZodLiteral<768>, z.ZodLiteral<1024>, z.ZodLiteral<1536>, z.ZodLiteral<3072>, z.ZodLiteral<4096>]>>>;
            apiKey: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            batchSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        }, "strip", z.ZodTypeAny, {
            provider?: "openai" | "cohere" | "voyageai" | "custom" | undefined;
            model?: string | undefined;
            dimension?: 768 | 1024 | 1536 | 3072 | 4096 | undefined;
            apiKey?: string | undefined;
            batchSize?: number | undefined;
        }, {
            provider?: "openai" | "cohere" | "voyageai" | "custom" | undefined;
            model?: string | undefined;
            dimension?: 768 | 1024 | 1536 | 3072 | 4096 | undefined;
            apiKey?: string | undefined;
            batchSize?: number | undefined;
        }>>>;
        chunking: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            maxTokens: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            overlapTokens: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        }, "strip", z.ZodTypeAny, {
            maxTokens?: number | undefined;
            overlapTokens?: number | undefined;
            include?: string[] | undefined;
            exclude?: string[] | undefined;
        }, {
            maxTokens?: number | undefined;
            overlapTokens?: number | undefined;
            include?: string[] | undefined;
            exclude?: string[] | undefined;
        }>>>;
        autoIndex: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        enabled?: boolean | undefined;
        embedding?: {
            provider?: "openai" | "cohere" | "voyageai" | "custom" | undefined;
            model?: string | undefined;
            dimension?: 768 | 1024 | 1536 | 3072 | 4096 | undefined;
            apiKey?: string | undefined;
            batchSize?: number | undefined;
        } | undefined;
        chunking?: {
            maxTokens?: number | undefined;
            overlapTokens?: number | undefined;
            include?: string[] | undefined;
            exclude?: string[] | undefined;
        } | undefined;
        autoIndex?: boolean | undefined;
    }, {
        enabled?: boolean | undefined;
        embedding?: {
            provider?: "openai" | "cohere" | "voyageai" | "custom" | undefined;
            model?: string | undefined;
            dimension?: 768 | 1024 | 1536 | 3072 | 4096 | undefined;
            apiKey?: string | undefined;
            batchSize?: number | undefined;
        } | undefined;
        chunking?: {
            maxTokens?: number | undefined;
            overlapTokens?: number | undefined;
            include?: string[] | undefined;
            exclude?: string[] | undefined;
        } | undefined;
        autoIndex?: boolean | undefined;
    }>>>;
    fs: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        type: z.ZodOptional<z.ZodOptional<z.ZodEnum<["local", "veryfront-api", "memory", "github"]>>>;
        local: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            baseDir: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            baseDir?: string | undefined;
        }, {
            baseDir?: string | undefined;
        }>>>;
        veryfront: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            apiBaseUrl: z.ZodOptional<z.ZodString>;
            apiToken: z.ZodOptional<z.ZodString>;
            projectSlug: z.ZodOptional<z.ZodString>;
            proxyMode: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            productionMode: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            cache: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                enabled: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
                ttl: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                maxSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            }, "strip", z.ZodTypeAny, {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
            }, {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
            }>>>;
            retry: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                maxRetries: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                initialDelay: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                maxDelay: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            }, "strip", z.ZodTypeAny, {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            }, {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            }>>>;
        }, "strip", z.ZodTypeAny, {
            projectSlug?: string | undefined;
            cache?: {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
            } | undefined;
            apiBaseUrl?: string | undefined;
            apiToken?: string | undefined;
            proxyMode?: boolean | undefined;
            productionMode?: boolean | undefined;
            retry?: {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            } | undefined;
        }, {
            projectSlug?: string | undefined;
            cache?: {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
            } | undefined;
            apiBaseUrl?: string | undefined;
            apiToken?: string | undefined;
            proxyMode?: boolean | undefined;
            productionMode?: boolean | undefined;
            retry?: {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            } | undefined;
        }>>>;
        memory: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            files: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>>>>;
        }, "strip", z.ZodTypeAny, {
            files?: Record<string, string | Uint8Array<ArrayBuffer>> | undefined;
        }, {
            files?: Record<string, string | Uint8Array<ArrayBuffer>> | undefined;
        }>>>;
        github: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            token: z.ZodOptional<z.ZodString>;
            owner: z.ZodOptional<z.ZodString>;
            repo: z.ZodOptional<z.ZodString>;
            ref: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            cache: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                enabled: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
                ttl: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                maxSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                maxMemory: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            }, "strip", z.ZodTypeAny, {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
                maxMemory?: number | undefined;
            }, {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
                maxMemory?: number | undefined;
            }>>>;
            retry: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                maxRetries: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                initialDelay: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                maxDelay: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            }, "strip", z.ZodTypeAny, {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            }, {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            }>>>;
        }, "strip", z.ZodTypeAny, {
            token?: string | undefined;
            cache?: {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
                maxMemory?: number | undefined;
            } | undefined;
            retry?: {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            } | undefined;
            owner?: string | undefined;
            repo?: string | undefined;
            ref?: string | undefined;
        }, {
            token?: string | undefined;
            cache?: {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
                maxMemory?: number | undefined;
            } | undefined;
            retry?: {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            } | undefined;
            owner?: string | undefined;
            repo?: string | undefined;
            ref?: string | undefined;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        memory?: {
            files?: Record<string, string | Uint8Array<ArrayBuffer>> | undefined;
        } | undefined;
        local?: {
            baseDir?: string | undefined;
        } | undefined;
        github?: {
            token?: string | undefined;
            cache?: {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
                maxMemory?: number | undefined;
            } | undefined;
            retry?: {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            } | undefined;
            owner?: string | undefined;
            repo?: string | undefined;
            ref?: string | undefined;
        } | undefined;
        type?: "memory" | "local" | "veryfront-api" | "github" | undefined;
        veryfront?: {
            projectSlug?: string | undefined;
            cache?: {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
            } | undefined;
            apiBaseUrl?: string | undefined;
            apiToken?: string | undefined;
            proxyMode?: boolean | undefined;
            productionMode?: boolean | undefined;
            retry?: {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            } | undefined;
        } | undefined;
    }, {
        memory?: {
            files?: Record<string, string | Uint8Array<ArrayBuffer>> | undefined;
        } | undefined;
        local?: {
            baseDir?: string | undefined;
        } | undefined;
        github?: {
            token?: string | undefined;
            cache?: {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
                maxMemory?: number | undefined;
            } | undefined;
            retry?: {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            } | undefined;
            owner?: string | undefined;
            repo?: string | undefined;
            ref?: string | undefined;
        } | undefined;
        type?: "memory" | "local" | "veryfront-api" | "github" | undefined;
        veryfront?: {
            projectSlug?: string | undefined;
            cache?: {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
            } | undefined;
            apiBaseUrl?: string | undefined;
            apiToken?: string | undefined;
            proxyMode?: boolean | undefined;
            productionMode?: boolean | undefined;
            retry?: {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            } | undefined;
        } | undefined;
    }>>>;
    client: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        moduleResolution: z.ZodOptional<z.ZodOptional<z.ZodEnum<["cdn", "self-hosted", "bundled"]>>>;
        cdn: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            provider: z.ZodOptional<z.ZodOptional<z.ZodEnum<["esm.sh", "unpkg", "jsdelivr"]>>>;
            versions: z.ZodOptional<z.ZodOptional<z.ZodUnion<[z.ZodLiteral<"auto">, z.ZodObject<{
                react: z.ZodOptional<z.ZodString>;
                veryfront: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                react?: string | undefined;
                veryfront?: string | undefined;
            }, {
                react?: string | undefined;
                veryfront?: string | undefined;
            }>]>>>;
        }, "strip", z.ZodTypeAny, {
            provider?: "esm.sh" | "unpkg" | "jsdelivr" | undefined;
            versions?: "auto" | {
                react?: string | undefined;
                veryfront?: string | undefined;
            } | undefined;
        }, {
            provider?: "esm.sh" | "unpkg" | "jsdelivr" | undefined;
            versions?: "auto" | {
                react?: string | undefined;
                veryfront?: string | undefined;
            } | undefined;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        cdn?: {
            provider?: "esm.sh" | "unpkg" | "jsdelivr" | undefined;
            versions?: "auto" | {
                react?: string | undefined;
                veryfront?: string | undefined;
            } | undefined;
        } | undefined;
        moduleResolution?: "cdn" | "self-hosted" | "bundled" | undefined;
    }, {
        cdn?: {
            provider?: "esm.sh" | "unpkg" | "jsdelivr" | undefined;
            versions?: "auto" | {
                react?: string | undefined;
                veryfront?: string | undefined;
            } | undefined;
        } | undefined;
        moduleResolution?: "cdn" | "self-hosted" | "bundled" | undefined;
    }>>>;
    tailwind: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        stylesheet: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        plugins: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodEnum<["forms", "typography", "aspect-ratio", "container-queries"]>, "many">>>;
        theme: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            extend: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
        }, "strip", z.ZodTypeAny, {
            extend?: Record<string, unknown> | undefined;
        }, {
            extend?: Record<string, unknown> | undefined;
        }>>>;
        customCSS: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        theme?: {
            extend?: Record<string, unknown> | undefined;
        } | undefined;
        stylesheet?: string | undefined;
        plugins?: ("forms" | "typography" | "aspect-ratio" | "container-queries")[] | undefined;
        customCSS?: string | undefined;
    }, {
        theme?: {
            extend?: Record<string, unknown> | undefined;
        } | undefined;
        stylesheet?: string | undefined;
        plugins?: ("forms" | "typography" | "aspect-ratio" | "container-queries")[] | undefined;
        customCSS?: string | undefined;
    }>>>;
}, "strip", z.ZodTypeAny, {
    search?: {
        enabled?: boolean | undefined;
        embedding?: {
            provider?: "openai" | "cohere" | "voyageai" | "custom" | undefined;
            model?: string | undefined;
            dimension?: 768 | 1024 | 1536 | 3072 | 4096 | undefined;
            apiKey?: string | undefined;
            batchSize?: number | undefined;
        } | undefined;
        chunking?: {
            maxTokens?: number | undefined;
            overlapTokens?: number | undefined;
            include?: string[] | undefined;
            exclude?: string[] | undefined;
        } | undefined;
        autoIndex?: boolean | undefined;
    } | undefined;
    app?: string | false | undefined;
    client?: {
        cdn?: {
            provider?: "esm.sh" | "unpkg" | "jsdelivr" | undefined;
            versions?: "auto" | {
                react?: string | undefined;
                veryfront?: string | undefined;
            } | undefined;
        } | undefined;
        moduleResolution?: "cdn" | "self-hosted" | "bundled" | undefined;
    } | undefined;
    build?: {
        outDir?: string | undefined;
        trailingSlash?: boolean | undefined;
        esbuild?: {
            wasmURL?: string | undefined;
            worker?: boolean | undefined;
        } | undefined;
    } | undefined;
    projectSlug?: string | undefined;
    title?: string | undefined;
    description?: string | undefined;
    react?: {
        version?: string | undefined;
    } | undefined;
    experimental?: {
        esmLayouts?: boolean | undefined;
        precompileMDX?: boolean | undefined;
        rsc?: boolean | undefined;
    } | undefined;
    router?: "app" | "pages" | undefined;
    layout?: string | false | undefined;
    theme?: {
        colors?: Record<string, string> | undefined;
    } | undefined;
    cache?: {
        dir?: string | undefined;
        bundleManifest?: {
            type?: "memory" | "redis" | "kv" | undefined;
            redisUrl?: string | undefined;
            keyPrefix?: string | undefined;
            ttl?: number | undefined;
            enabled?: boolean | undefined;
        } | undefined;
    } | undefined;
    dev?: {
        open?: boolean | undefined;
        host?: string | undefined;
        port?: number | undefined;
        hmr?: boolean | undefined;
        components?: string[] | undefined;
    } | undefined;
    resolve?: {
        importMap?: {
            imports?: Record<string, string> | undefined;
            scopes?: Record<string, Record<string, string>> | undefined;
        } | undefined;
    } | undefined;
    security?: {
        auth?: {
            basic?: {
                password: string;
                username: string;
                realm?: string | undefined;
            } | undefined;
            bearer?: {
                token: string;
            } | undefined;
        } | undefined;
        csp?: Record<string, string[]> | undefined;
        remoteHosts?: string[] | undefined;
        cors?: boolean | {
            origin?: string | undefined;
        } | undefined;
        coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none" | undefined;
        corp?: "same-origin" | "same-site" | "cross-origin" | undefined;
        coep?: "unsafe-none" | "require-corp" | undefined;
    } | undefined;
    middleware?: {
        custom?: ((...args: unknown[]) => unknown)[] | undefined;
    } | undefined;
    theming?: {
        brandName?: string | undefined;
        logoHtml?: string | undefined;
    } | undefined;
    assetPipeline?: {
        css?: {
            enabled?: boolean | undefined;
            inputDir?: string | undefined;
            outputDir?: string | undefined;
            minify?: boolean | undefined;
            autoprefixer?: boolean | undefined;
            purge?: boolean | undefined;
            criticalCSS?: boolean | undefined;
            browsers?: string[] | undefined;
            purgeContent?: string[] | undefined;
            sourceMap?: boolean | undefined;
        } | undefined;
        images?: {
            enabled?: boolean | undefined;
            formats?: ("webp" | "avif" | "jpeg" | "png")[] | undefined;
            sizes?: number[] | undefined;
            quality?: number | undefined;
            inputDir?: string | undefined;
            outputDir?: string | undefined;
            preserveOriginal?: boolean | undefined;
        } | undefined;
    } | undefined;
    observability?: {
        tracing?: {
            endpoint?: string | undefined;
            enabled?: boolean | undefined;
            exporter?: "console" | "jaeger" | "zipkin" | "otlp" | undefined;
            serviceName?: string | undefined;
            sampleRate?: number | undefined;
        } | undefined;
        metrics?: {
            endpoint?: string | undefined;
            enabled?: boolean | undefined;
            exporter?: "console" | "otlp" | "prometheus" | undefined;
            prefix?: string | undefined;
            collectInterval?: number | undefined;
        } | undefined;
    } | undefined;
    fs?: {
        memory?: {
            files?: Record<string, string | Uint8Array<ArrayBuffer>> | undefined;
        } | undefined;
        local?: {
            baseDir?: string | undefined;
        } | undefined;
        github?: {
            token?: string | undefined;
            cache?: {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
                maxMemory?: number | undefined;
            } | undefined;
            retry?: {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            } | undefined;
            owner?: string | undefined;
            repo?: string | undefined;
            ref?: string | undefined;
        } | undefined;
        type?: "memory" | "local" | "veryfront-api" | "github" | undefined;
        veryfront?: {
            projectSlug?: string | undefined;
            cache?: {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
            } | undefined;
            apiBaseUrl?: string | undefined;
            apiToken?: string | undefined;
            proxyMode?: boolean | undefined;
            productionMode?: boolean | undefined;
            retry?: {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            } | undefined;
        } | undefined;
    } | undefined;
    tailwind?: {
        theme?: {
            extend?: Record<string, unknown> | undefined;
        } | undefined;
        stylesheet?: string | undefined;
        plugins?: ("forms" | "typography" | "aspect-ratio" | "container-queries")[] | undefined;
        customCSS?: string | undefined;
    } | undefined;
}, {
    search?: {
        enabled?: boolean | undefined;
        embedding?: {
            provider?: "openai" | "cohere" | "voyageai" | "custom" | undefined;
            model?: string | undefined;
            dimension?: 768 | 1024 | 1536 | 3072 | 4096 | undefined;
            apiKey?: string | undefined;
            batchSize?: number | undefined;
        } | undefined;
        chunking?: {
            maxTokens?: number | undefined;
            overlapTokens?: number | undefined;
            include?: string[] | undefined;
            exclude?: string[] | undefined;
        } | undefined;
        autoIndex?: boolean | undefined;
    } | undefined;
    app?: string | false | undefined;
    client?: {
        cdn?: {
            provider?: "esm.sh" | "unpkg" | "jsdelivr" | undefined;
            versions?: "auto" | {
                react?: string | undefined;
                veryfront?: string | undefined;
            } | undefined;
        } | undefined;
        moduleResolution?: "cdn" | "self-hosted" | "bundled" | undefined;
    } | undefined;
    build?: {
        outDir?: string | undefined;
        trailingSlash?: boolean | undefined;
        esbuild?: {
            wasmURL?: string | undefined;
            worker?: boolean | undefined;
        } | undefined;
    } | undefined;
    projectSlug?: string | undefined;
    title?: string | undefined;
    description?: string | undefined;
    react?: {
        version?: string | undefined;
    } | undefined;
    experimental?: {
        esmLayouts?: boolean | undefined;
        precompileMDX?: boolean | undefined;
        rsc?: boolean | undefined;
    } | undefined;
    router?: "app" | "pages" | undefined;
    layout?: string | false | undefined;
    theme?: {
        colors?: Record<string, string> | undefined;
    } | undefined;
    cache?: {
        dir?: string | undefined;
        bundleManifest?: {
            type?: "memory" | "redis" | "kv" | undefined;
            redisUrl?: string | undefined;
            keyPrefix?: string | undefined;
            ttl?: number | undefined;
            enabled?: boolean | undefined;
        } | undefined;
    } | undefined;
    dev?: {
        open?: boolean | undefined;
        host?: string | undefined;
        port?: number | undefined;
        hmr?: boolean | undefined;
        components?: string[] | undefined;
    } | undefined;
    resolve?: {
        importMap?: {
            imports?: Record<string, string> | undefined;
            scopes?: Record<string, Record<string, string>> | undefined;
        } | undefined;
    } | undefined;
    security?: {
        auth?: {
            basic?: {
                password: string;
                username: string;
                realm?: string | undefined;
            } | undefined;
            bearer?: {
                token: string;
            } | undefined;
        } | undefined;
        csp?: Record<string, string[]> | undefined;
        remoteHosts?: string[] | undefined;
        cors?: boolean | {
            origin?: string | undefined;
        } | undefined;
        coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none" | undefined;
        corp?: "same-origin" | "same-site" | "cross-origin" | undefined;
        coep?: "unsafe-none" | "require-corp" | undefined;
    } | undefined;
    middleware?: {
        custom?: ((...args: unknown[]) => unknown)[] | undefined;
    } | undefined;
    theming?: {
        brandName?: string | undefined;
        logoHtml?: string | undefined;
    } | undefined;
    assetPipeline?: {
        css?: {
            enabled?: boolean | undefined;
            inputDir?: string | undefined;
            outputDir?: string | undefined;
            minify?: boolean | undefined;
            autoprefixer?: boolean | undefined;
            purge?: boolean | undefined;
            criticalCSS?: boolean | undefined;
            browsers?: string[] | undefined;
            purgeContent?: string[] | undefined;
            sourceMap?: boolean | undefined;
        } | undefined;
        images?: {
            enabled?: boolean | undefined;
            formats?: ("webp" | "avif" | "jpeg" | "png")[] | undefined;
            sizes?: number[] | undefined;
            quality?: number | undefined;
            inputDir?: string | undefined;
            outputDir?: string | undefined;
            preserveOriginal?: boolean | undefined;
        } | undefined;
    } | undefined;
    observability?: {
        tracing?: {
            endpoint?: string | undefined;
            enabled?: boolean | undefined;
            exporter?: "console" | "jaeger" | "zipkin" | "otlp" | undefined;
            serviceName?: string | undefined;
            sampleRate?: number | undefined;
        } | undefined;
        metrics?: {
            endpoint?: string | undefined;
            enabled?: boolean | undefined;
            exporter?: "console" | "otlp" | "prometheus" | undefined;
            prefix?: string | undefined;
            collectInterval?: number | undefined;
        } | undefined;
    } | undefined;
    fs?: {
        memory?: {
            files?: Record<string, string | Uint8Array<ArrayBuffer>> | undefined;
        } | undefined;
        local?: {
            baseDir?: string | undefined;
        } | undefined;
        github?: {
            token?: string | undefined;
            cache?: {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
                maxMemory?: number | undefined;
            } | undefined;
            retry?: {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            } | undefined;
            owner?: string | undefined;
            repo?: string | undefined;
            ref?: string | undefined;
        } | undefined;
        type?: "memory" | "local" | "veryfront-api" | "github" | undefined;
        veryfront?: {
            projectSlug?: string | undefined;
            cache?: {
                ttl?: number | undefined;
                enabled?: boolean | undefined;
                maxSize?: number | undefined;
            } | undefined;
            apiBaseUrl?: string | undefined;
            apiToken?: string | undefined;
            proxyMode?: boolean | undefined;
            productionMode?: boolean | undefined;
            retry?: {
                maxRetries?: number | undefined;
                initialDelay?: number | undefined;
                maxDelay?: number | undefined;
            } | undefined;
        } | undefined;
    } | undefined;
    tailwind?: {
        theme?: {
            extend?: Record<string, unknown> | undefined;
        } | undefined;
        stylesheet?: string | undefined;
        plugins?: ("forms" | "typography" | "aspect-ratio" | "container-queries")[] | undefined;
        customCSS?: string | undefined;
    } | undefined;
}>;
export type VeryfrontConfigInput = z.input<typeof veryfrontConfigSchema>;
export declare function validateVeryfrontConfig(input: unknown): VeryfrontConfig;
export declare function findUnknownTopLevelKeys(input: Record<string, unknown>): string[];
//# sourceMappingURL=schema.d.ts.map