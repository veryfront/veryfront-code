import { join } from "../../platform/compat/path-helper.js";
import { extractHTMLMetadata, generateHTMLShellParts, injectHTMLContent, isFullHTMLDocument, } from "../../html/index.js";
import { extractCandidates } from "../../html/styles-builder/tailwind-compiler.js";
import { DEFAULT_DASHBOARD_PORT, rendererLogger as logger } from "../../utils/index.js";
import { injectElementSelectors } from "../../studio/element-selector-injector.js";
import { computeSourceHash } from "../../studio/hash-utils.js";
import { extractRelativePath } from "../../utils/route-path-utils.js";
import { resolveAppComponentPath } from "../layouts/utils/app-resolver.js";
import { StreamTimeoutError, streamToString } from "../utils/stream-utils.js";
export class HTMLGenerator {
    config;
    constructor(config) {
        this.config = config;
    }
    async generateFullHTML(context) {
        const html = isFullHTMLDocument(context.html)
            ? await this.handleFullHTMLDocument(context)
            : await this.wrapHTMLFragment(context);
        if (!context.options?.studioEmbed)
            return html;
        logger.debug("[HTMLGenerator] Injected element selectors for Studio");
        return injectElementSelectors(html);
    }
    async generateHTMLStream(reactStream, context) {
        const mergedFrontmatter = this.mergeFrontmatter(context);
        const htmlOptions = await this.buildHTMLOptions(context, mergedFrontmatter);
        let reactContent;
        try {
            reactContent = (await streamToString(reactStream)).trim();
        }
        catch (error) {
            if (!(error instanceof StreamTimeoutError))
                throw error;
            logger.warn("[HTMLGenerator] Stream timed out, using partial content", {
                partialLength: error.partialContent.length,
            });
            reactContent = error.partialContent.trim();
        }
        const { start, end } = await this.generateShellParts(context, mergedFrontmatter, htmlOptions, reactContent);
        const encoder = new TextEncoder();
        const fullHtml = `${start}${reactContent}${end}`;
        return new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(fullHtml));
                controller.close();
            },
        });
    }
    async handleFullHTMLDocument(context) {
        const metadata = extractHTMLMetadata((context.pageInfo.entity.frontmatter || {}), (context.layoutBundle?.frontmatter || {}));
        let isClientPage = false;
        const pagePath = context.pageInfo.entity.path;
        try {
            const pageContent = await this.config.adapter.fs.readFile(pagePath);
            isClientPage = /^\s*['"]use client['"];?\s*$/m.test(pageContent);
            if (isClientPage) {
                logger.debug(`[HTMLGenerator] Detected 'use client' page: ${pagePath}`);
            }
        }
        catch {
            logger.debug(`[HTMLGenerator] Could not read page file for directive detection: ${pagePath}`);
        }
        const injectedHtml = injectHTMLContent(context.html, "", metadata, {
            mode: this.config.mode,
            slug: context.slug,
            devPort: this.config.config?.dev?.port || DEFAULT_DASHBOARD_PORT,
            pagePath,
            isClientPage,
        });
        if (injectedHtml.trimStart().toLowerCase().startsWith("<!doctype")) {
            return injectedHtml;
        }
        return `<!DOCTYPE html>\n${injectedHtml}`;
    }
    async wrapHTMLFragment(context) {
        const mergedFrontmatter = this.mergeFrontmatter(context);
        const htmlOptions = await this.buildHTMLOptions(context, mergedFrontmatter);
        const reactContent = context.html.trim();
        const { start, end } = await this.generateShellParts(context, mergedFrontmatter, htmlOptions, reactContent);
        return `${start}${reactContent}${end}`;
    }
    async generateShellParts(context, mergedFrontmatter, htmlOptions, reactContent) {
        const head = context.collectedHead;
        const effectiveTitle = head?.title || mergedFrontmatter.title || "Veryfront App";
        const effectiveDescription = head?.description || mergedFrontmatter.description || "";
        const enrichedFrontmatter = {
            ...mergedFrontmatter,
            ...(head?.title && { title: head.title }),
            ...(head?.description && { description: head.description }),
        };
        const { start, end } = await generateHTMLShellParts({
            title: effectiveTitle,
            description: effectiveDescription,
            slug: context.slug,
            frontmatter: enrichedFrontmatter,
            layoutFrontmatter: context.layoutBundle?.frontmatter,
            ssrHash: context.ssrHash,
        }, htmlOptions, context.options?.params, context.options?.props, reactContent);
        const headElements = this.buildHeadElements(head);
        if (!headElements)
            return { start, end };
        return {
            start: start.replace("</head>", `  ${headElements}\n</head>`),
            end,
        };
    }
    buildHeadElements(head) {
        if (!head)
            return "";
        const parts = [];
        for (const meta of head.metas) {
            if (meta.name === "description")
                continue;
            const attrs = [];
            if (meta.name)
                attrs.push(`name="${meta.name}"`);
            if (meta.property)
                attrs.push(`property="${meta.property}"`);
            if (meta.content)
                attrs.push(`content="${meta.content}"`);
            if (attrs.length)
                parts.push(`<meta ${attrs.join(" ")}>`);
        }
        for (const link of head.links) {
            const attrs = Object.entries(link)
                .filter(([, v]) => v != null)
                .map(([k, v]) => `${k}="${v}"`)
                .join(" ");
            if (attrs)
                parts.push(`<link ${attrs}>`);
        }
        for (const style of head.styles) {
            parts.push(`<style>${style}</style>`);
        }
        return parts.join("\n  ");
    }
    mergeFrontmatter(context) {
        return {
            ...context.pageInfo.entity.frontmatter,
            ...context.pageBundle.frontmatter,
            ...(context.collectedMetadata || {}),
        };
    }
    resolveAppPath() {
        return resolveAppComponentPath(this.config.projectDir, this.config.adapter, this.config.config);
    }
    async loadProjectFile(filename) {
        try {
            const filePath = join(this.config.projectDir, filename);
            const content = await this.config.adapter.fs.readFile(filePath);
            logger.debug(`[HTMLGenerator] Loaded ${filename}`, { length: content.length });
            return content;
        }
        catch {
            logger.debug(`[HTMLGenerator] No ${filename} found, using default`);
            return undefined;
        }
    }
    async buildHTMLOptions(context, mergedFrontmatter) {
        // Load app path, global CSS, and extract project classes in parallel
        // Note: tailwind.config.js is not loaded - Tailwind v4 uses CSS @theme directive instead
        const stylesheetPath = this.config.config?.tailwind?.stylesheet || "globals.css";
        const [appComponentPath, globalCSS, projectClasses] = await Promise.all([
            this.resolveAppPath().then((p) => p ?? undefined),
            this.loadProjectFile(stylesheetPath),
            this.extractProjectClasses(),
        ]);
        logger.debug("[HTMLGenerator] App component resolution", {
            appComponentPath,
            projectDir: this.config.projectDir,
            hasConfig: !!this.config.config,
            configApp: this.config.config?.app,
        });
        const pagePath = extractRelativePath(context.pageInfo.entity.path, this.config.projectDir);
        // Determine pageType from file extension
        const fileExtension = context.pageInfo.entity.path.split(".").pop()?.toLowerCase();
        const pageType = fileExtension;
        const sourceHash = context.options?.studioEmbed && context.pageInfo.entity.content
            ? computeSourceHash(context.pageInfo.entity.content)
            : undefined;
        return {
            mode: this.config.mode,
            config: this.config.config,
            projectDir: this.config.projectDir,
            nestedLayouts: context.nestedLayouts.map((l) => ({
                kind: l.kind,
                path: l.path,
                componentPath: l.componentPath,
            })),
            appPath: appComponentPath,
            pagePath,
            pageType,
            nonce: context.options?.nonce,
            globalCSS,
            frontmatter: mergedFrontmatter,
            studioEmbed: context.options?.studioEmbed,
            projectId: context.options?.projectId,
            pageId: context.options?.pageId,
            sourceHash,
            colorScheme: context.options?.colorScheme,
            colorSchemeFromParam: context.options?.colorSchemeFromParam,
            environment: context.options?.environment,
            headings: context.pageBundle.headings,
            projectClasses,
            isLocalDev: this.config.mode === "development",
            noHmr: context.options?.noHmr,
        };
    }
    async extractProjectClasses() {
        const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];
        const classes = new Set();
        const wrappedFs = this.config.adapter.fs;
        if (typeof wrappedFs.getUnderlyingAdapter !== "function")
            return classes;
        const fsAdapter = wrappedFs.getUnderlyingAdapter();
        if (typeof fsAdapter.getAllSourceFiles !== "function")
            return classes;
        const files = await fsAdapter.getAllSourceFiles();
        let filesProcessed = 0;
        for (const file of files) {
            if (!file.content)
                continue;
            if (!SOURCE_EXTENSIONS.some((ext) => file.path.endsWith(ext)))
                continue;
            filesProcessed++;
            for (const cls of extractCandidates(file.content)) {
                classes.add(cls);
            }
        }
        logger.debug("[HTMLGenerator] extractProjectClasses", {
            filesProcessed,
            totalClasses: classes.size,
        });
        return classes;
    }
}
