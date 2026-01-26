import { rendererLogger as logger } from "../utils/index.js";
import { ErrorCode, VeryfrontError } from "../errors/index.js";
import { mdxRenderer } from "../transforms/mdx/index.js";
import { getProjectReact } from "../react/index.js";
import { compileContent } from "../transforms/mdx/compiler/index.js";
import { ensureError, getErrorMessage } from "../errors/veryfront-error.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
export function handleMDXPage(pageInfo, slug, projectDir, mergedComponents, _compileMDX, adapter, options) {
    return withSpan("rendering.handleMDXPage", async () => {
        const frontmatter = pageInfo.entity.frontmatter;
        const fmArg = frontmatter && Object.keys(frontmatter).length > 0 ? frontmatter : undefined;
        const ssrBundle = await compileContent("development", projectDir, pageInfo.entity.content, fmArg, pageInfo.entity.path, "server");
        const pageBundle = ssrBundle;
        let collectedMetadata = {};
        try {
            if (options?.precompiledModule) {
                pageBundle.clientModuleCode = options.precompiledModule;
            }
            else {
                const browserBundle = await compileContent("development", projectDir, pageInfo.entity.content, fmArg, pageInfo.entity.path, "browser");
                pageBundle.clientModuleCode = browserBundle.compiledCode;
            }
            const clientModuleCode = pageBundle.clientModuleCode;
            if (!clientModuleCode) {
                throw new VeryfrontError("MDX compilation produced no client module code", ErrorCode.RENDER_ERROR);
            }
            const mod = (await mdxRenderer.loadModuleESM(clientModuleCode, adapter, options?.projectId, projectDir, options?.projectSlug, options?.contentSourceId));
            const MDXComp = mod.MDXContent || mod.default;
            if (!MDXComp) {
                throw new VeryfrontError("Compiled MDX module has no content export", ErrorCode.RENDER_ERROR);
            }
            if (mod.metadata && typeof mod.metadata === "object") {
                collectedMetadata = { ...collectedMetadata, ...mod.metadata };
            }
            try {
                if (typeof mod.generateMetadata === "function") {
                    const params = options?.params
                        ? Object.fromEntries(Object.entries(options.params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
                        : {};
                    const gen = await mod.generateMetadata({
                        params,
                        slug,
                        path: pageInfo.entity.path,
                        frontmatter: frontmatter || {},
                    });
                    if (gen && typeof gen === "object") {
                        collectedMetadata = { ...collectedMetadata, ...gen };
                    }
                }
            }
            catch (e) {
                const normalizedError = ensureError(e);
                logger.warn("generateMetadata threw for MDX page", normalizedError);
                if (normalizedError.message.includes("ReferenceError") ||
                    normalizedError.message.includes("SyntaxError")) {
                    throw normalizedError;
                }
            }
            // Get project's React for createElement to ensure element symbols match user components
            const React = await getProjectReact();
            const pageElement = React.createElement(MDXComp, { components: mergedComponents });
            return { pageElement, pageBundle, collectedMetadata };
        }
        catch (error) {
            throw new VeryfrontError(`Failed to import MDX page via ESM: ${getErrorMessage(error)}`, ErrorCode.RENDER_ERROR, { slug, error });
        }
    }, { "rendering.slug": slug, "rendering.pagePath": pageInfo.entity.path });
}
