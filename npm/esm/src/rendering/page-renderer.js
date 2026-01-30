import { rendererLogger as logger } from "../utils/index.js";
import { getExtensionName } from "../utils/path-utils.js";
import { ErrorCode, VeryfrontError } from "../errors/index.js";
import { createDefaultMDXComponents } from "./utils/index.js";
import { extractRouteParams } from "../utils/route-path-utils.js";
import { handleComponentPage } from "./component-handling.js";
import { handleMDXPage } from "./page-rendering.js";
import { handleScriptPage } from "./script-page-handling.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
export class PageRenderer {
    projectDir;
    mode;
    config;
    adapter;
    componentRegistry;
    compileMDX;
    moduleServerUrl;
    constructor(options) {
        this.projectDir = options.projectDir;
        this.mode = options.mode;
        this.config = options.config;
        this.adapter = options.adapter;
        this.componentRegistry = options.componentRegistry;
        this.compileMDX = options.compileMDX;
        this.moduleServerUrl = options.moduleServerUrl;
    }
    getMergedComponents() {
        return {
            ...createDefaultMDXComponents(),
            ...this.componentRegistry.getAllAsComponents(),
        };
    }
    detectPageType(pageInfo) {
        const extension = getExtensionName(pageInfo.entity.path);
        if (extension === "tsx" || extension === "jsx") {
            return { type: "component", extension };
        }
        if (extension === "ts" || extension === "js") {
            return { type: "script", extension };
        }
        return { type: "mdx", extension };
    }
    preparePageBundles(pageInfo, slug, cachedModule, options) {
        const pageType = this.detectPageType(pageInfo);
        return withSpan("render.prepare_page", async () => {
            logger.debug(`Page file info:`, {
                path: pageInfo.entity.path,
                extension: pageType.extension,
                type: pageType.type,
                slug,
            });
            if (pageType.type === "script") {
                const scriptResult = await withSpan("render.handle_script", () => handleScriptPage(pageInfo, slug, {
                    mode: this.mode,
                    config: this.config,
                    projectDir: this.projectDir,
                    adapter: this.adapter,
                    params: options?.params,
                    props: options?.props,
                    nonce: options?.nonce,
                }), { "render.script_path": pageInfo.entity.path });
                return { collectedMetadata: {}, scriptResult };
            }
            let pageElement;
            let pageBundle;
            let clientModuleCode = cachedModule?.code;
            let pageModuleType = cachedModule?.type;
            let collectedMetadata = {};
            if (pageType.type === "component") {
                let params = options?.params;
                if (!params || Object.keys(params).length === 0) {
                    const extracted = extractRouteParams(pageInfo.entity.path, slug);
                    params = extracted.matched ? extracted.params : undefined;
                }
                const componentProps = {
                    ...options?.props,
                    ...(params && Object.keys(params).length > 0 ? { params } : {}),
                };
                const result = await withSpan("render.handle_component", () => handleComponentPage(pageInfo, slug, this.projectDir, this.componentRegistry, this.adapter, {
                    props: componentProps,
                    cachedClientModule: cachedModule?.type === "component"
                        ? cachedModule.code
                        : undefined,
                    moduleServerUrl: this.moduleServerUrl,
                    projectId: options?.projectId,
                    studioEmbed: options?.studioEmbed,
                    contentSourceId: options?.contentSourceId,
                }), { "render.component_path": pageInfo.entity.path });
                pageElement = result.pageElement;
                pageBundle = result.pageBundle;
                clientModuleCode = result.pageBundle.clientModuleCode ?? clientModuleCode;
                pageModuleType = "component";
                return {
                    pageElement,
                    pageBundle,
                    clientModuleCode,
                    pageModuleType,
                    collectedMetadata,
                };
            }
            const mdxResult = await withSpan("render.handle_mdx", () => handleMDXPage(pageInfo, slug, this.projectDir, this.getMergedComponents(), this.compileMDX, this.adapter, {
                params: options?.params,
                precompiledModule: cachedModule?.type === "mdx" ? cachedModule.code : undefined,
                projectId: options?.projectId,
                studioEmbed: options?.studioEmbed,
                projectSlug: options?.projectSlug,
                contentSourceId: options?.contentSourceId,
            }), { "render.mdx_path": pageInfo.entity.path });
            pageElement = mdxResult.pageElement;
            pageBundle = mdxResult.pageBundle;
            collectedMetadata = mdxResult.collectedMetadata;
            clientModuleCode = mdxResult.pageBundle.clientModuleCode;
            pageModuleType = "mdx";
            return {
                pageElement,
                pageBundle,
                clientModuleCode,
                pageModuleType,
                collectedMetadata,
            };
        }, {
            "render.page_type": pageType.type,
            "render.slug": slug,
            "render.path": pageInfo.entity.path,
            "render.has_cached_module": !!cachedModule,
        });
    }
    getPageType(pageInfo) {
        const detected = this.detectPageType(pageInfo);
        const descriptions = {
            mdx: "MDX content page with React components",
            component: "React component page (TSX/JSX)",
            script: "Script page returning Response (TS/JS)",
        };
        return { ...detected, description: descriptions[detected.type] };
    }
    validatePageBundle(result, slug) {
        if (result.scriptResult)
            return;
        if (result.pageElement && result.pageBundle)
            return;
        throw new VeryfrontError("Failed to prepare page bundle", ErrorCode.RENDER_ERROR, {
            slug,
            hasElement: !!result.pageElement,
            hasBundle: !!result.pageBundle,
        });
    }
}
