import { prefetchLogger } from "../browser-logger.ts";

export interface ResourceHint {
  type: "prefetch" | "preload" | "preconnect" | "dns-prefetch";
  href: string;
  as?: string;
  crossOrigin?: string;
  media?: string;
}

export class ResourceHintsManager {
  private appliedHints = new Set<string>();

  applyResourceHints(hints: ResourceHint[]): void {
    for (const hint of hints) {
      const key = `${hint.type}:${hint.href}`;

      if (this.appliedHints.has(key)) continue;

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

  private createAndAppendHint(hint: ResourceHint): void {
    if (!document.head) {
      prefetchLogger.warn("document.head is not available, skipping resource hint");
      return;
    }

    const link = document.createElement("link");
    link.rel = hint.type;
    link.href = hint.href;

    if (hint.as) link.setAttribute("as", hint.as);
    if (hint.crossOrigin) link.setAttribute("crossorigin", hint.crossOrigin);
    if (hint.media) link.setAttribute("media", hint.media);

    document.head.appendChild(link);
  }

  extractResourceHints(html: string, prefetchedUrls: Set<string>): ResourceHint[] {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const hints: ResourceHint[] = [];

      this.extractPreloadLinks(doc, prefetchedUrls, hints);
      this.extractScripts(doc, prefetchedUrls, hints);
      this.extractStylesheets(doc, prefetchedUrls, hints);

      return hints;
    } catch (error) {
      prefetchLogger.error("Failed to parse prefetched page", error);
      return [];
    }
  }

  private isValidResourceHintType(rel: string): rel is ResourceHint["type"] {
    return rel === "prefetch" || rel === "preload" || rel === "preconnect" ||
      rel === "dns-prefetch";
  }

  private extractPreloadLinks(
    doc: Document,
    prefetchedUrls: Set<string>,
    hints: ResourceHint[],
  ): void {
    for (const link of doc.querySelectorAll('link[rel="preload"], link[rel="prefetch"]')) {
      const htmlLink = link as HTMLLinkElement;
      const href = htmlLink.href;
      if (href && !prefetchedUrls.has(href) && this.isValidResourceHintType(htmlLink.rel)) {
        hints.push({
          type: htmlLink.rel,
          href,
          as: htmlLink.getAttribute("as") || undefined,
        });
      }
    }
  }

  private extractScripts(
    doc: Document,
    prefetchedUrls: Set<string>,
    hints: ResourceHint[],
  ): void {
    for (const script of doc.querySelectorAll("script[src]")) {
      const src = (script as HTMLScriptElement).src;
      if (src && !prefetchedUrls.has(src)) {
        hints.push({ type: "prefetch", href: src, as: "script" });
      }
    }
  }

  private extractStylesheets(
    doc: Document,
    prefetchedUrls: Set<string>,
    hints: ResourceHint[],
  ): void {
    for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
      const href = (link as HTMLLinkElement).href;
      if (href && !prefetchedUrls.has(href)) {
        hints.push({ type: "prefetch", href, as: "style" });
      }
    }
  }

  static generateResourceHints(_route: string, assets: string[]): string {
    const hints: string[] = [
      '<link rel="dns-prefetch" href="https://cdn.jsdelivr.net">',
      '<link rel="dns-prefetch" href="https://esm.sh">',
      '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>',
    ];

    for (const asset of assets) {
      if (asset.endsWith(".js")) {
        hints.push(`<link rel="modulepreload" href="${asset}">`);
      } else if (asset.endsWith(".css")) {
        hints.push(`<link rel="preload" as="style" href="${asset}">`);
      } else if (asset.match(/\.(woff2?|ttf|otf)$/)) {
        hints.push(`<link rel="preload" as="font" href="${asset}" crossorigin>`);
      }
    }

    return hints.join("\n");
  }
}
