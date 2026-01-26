import { prefetchLogger } from "../browser-logger.js";
export class ResourceHintsManager {
    appliedHints = new Set();
    applyResourceHints(hints) {
        for (const hint of hints) {
            const key = `${hint.type}:${hint.href}`;
            if (this.appliedHints.has(key))
                continue;
            const existing = document.querySelector(`link[rel="${hint.type}"][href="${hint.href}"]`);
            if (existing) {
                this.appliedHints.add(key);
                continue;
            }
            this.createAndAppendHint(hint);
            this.appliedHints.add(key);
            prefetchLogger.debug(`Added resource hint: ${hint.type} ${hint.href}`);
        }
    }
    createAndAppendHint(hint) {
        if (!document.head) {
            prefetchLogger.warn("document.head is not available, skipping resource hint");
            return;
        }
        const link = document.createElement("link");
        link.rel = hint.type;
        link.href = hint.href;
        const as = hint.as;
        if (as)
            link.setAttribute("as", as);
        const crossOrigin = hint.crossOrigin;
        if (crossOrigin)
            link.setAttribute("crossorigin", crossOrigin);
        const media = hint.media;
        if (media)
            link.setAttribute("media", media);
        document.head.appendChild(link);
    }
    extractResourceHints(html, prefetchedUrls) {
        try {
            const doc = new DOMParser().parseFromString(html, "text/html");
            const hints = [];
            this.extractPreloadLinks(doc, prefetchedUrls, hints);
            this.extractScripts(doc, prefetchedUrls, hints);
            this.extractStylesheets(doc, prefetchedUrls, hints);
            return hints;
        }
        catch (error) {
            prefetchLogger.error("Failed to parse prefetched page", error);
            return [];
        }
    }
    isValidResourceHintType(rel) {
        return (rel === "prefetch" ||
            rel === "preload" ||
            rel === "preconnect" ||
            rel === "dns-prefetch");
    }
    extractPreloadLinks(doc, prefetchedUrls, hints) {
        for (const link of doc.querySelectorAll('link[rel="preload"], link[rel="prefetch"]')) {
            const href = link.href;
            if (!href || prefetchedUrls.has(href) || !this.isValidResourceHintType(link.rel)) {
                continue;
            }
            hints.push({
                type: link.rel,
                href,
                as: link.getAttribute("as") ?? undefined,
            });
        }
    }
    extractScripts(doc, prefetchedUrls, hints) {
        for (const script of doc.querySelectorAll("script[src]")) {
            const src = script.src;
            if (!src || prefetchedUrls.has(src))
                continue;
            hints.push({ type: "prefetch", href: src, as: "script" });
        }
    }
    extractStylesheets(doc, prefetchedUrls, hints) {
        for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
            const href = link.href;
            if (!href || prefetchedUrls.has(href))
                continue;
            hints.push({ type: "prefetch", href, as: "style" });
        }
    }
    static generateResourceHints(_route, assets) {
        const hints = [
            '<link rel="dns-prefetch" href="https://cdn.jsdelivr.net">',
            '<link rel="dns-prefetch" href="https://esm.sh">',
            '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>',
        ];
        for (const asset of assets) {
            if (asset.endsWith(".js")) {
                hints.push(`<link rel="modulepreload" href="${asset}">`);
                continue;
            }
            if (asset.endsWith(".css")) {
                hints.push(`<link rel="preload" as="style" href="${asset}">`);
                continue;
            }
            if (/\.(woff2?|ttf|otf)$/.test(asset)) {
                hints.push(`<link rel="preload" as="font" href="${asset}" crossorigin>`);
            }
        }
        return hints.join("\n");
    }
}
