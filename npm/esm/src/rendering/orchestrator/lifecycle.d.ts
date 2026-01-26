import { MDXCacheAdapter } from "../../transforms/mdx/index.js";
import { ComponentRegistry } from "../ssr/component-registry.js";
import { VirtualModuleSystem } from "../virtual-module-system.js";
import { CacheCoordinator } from "../cache/index.js";
import { LayoutCollector, LayoutCompiler } from "../layouts/index.js";
import { PageRenderer } from "../page-renderer.js";
import { PageResolver } from "../page-resolution/index.js";
import { ElementValidator } from "../element-validator/index.js";
import { SSRRenderer } from "../ssr-renderer.js";
import type { ConfigurationManager } from "./config.js";
import type { MdxBundle } from "../../types/index.js";
import { CompilerService } from "./compiler-service.js";
export interface LifecycleOptions {
    configManager: ConfigurationManager;
    port: number;
    moduleServerUrl?: string;
    /** Project ID (UUID) for SSR cache isolation in multi-project mode */
    projectId?: string;
    /** Content source identifier for cache isolation (branch or release) */
    contentSourceId?: string;
}
export interface RendererServices {
    componentRegistry: ComponentRegistry;
    virtualModules: VirtualModuleSystem;
    cacheCoordinator: CacheCoordinator;
    mdxCacheAdapter: MDXCacheAdapter;
    layoutCollector: LayoutCollector;
    layoutCompiler: LayoutCompiler;
    elementValidator: ElementValidator;
    ssrRenderer: SSRRenderer;
    pageRenderer: PageRenderer;
    pageResolver: PageResolver;
    compilerService: CompilerService;
}
export declare class RendererLifecycle {
    private configManager;
    private port;
    private moduleServerUrl?;
    private projectId?;
    private contentSourceId?;
    private services?;
    private adapter;
    constructor(options: LifecycleOptions);
    initialize(): Promise<RendererServices>;
    updateCompileMDX(compileMDX: (content: string, frontmatter?: Record<string, unknown>, filePath?: string) => Promise<MdxBundle>): void;
    getServices(): RendererServices;
    initializeComponents(): Promise<void>;
    clearAllCaches(): void;
    clearSlugCache(slug: string): void;
    destroy(): Promise<void>;
}
//# sourceMappingURL=lifecycle.d.ts.map