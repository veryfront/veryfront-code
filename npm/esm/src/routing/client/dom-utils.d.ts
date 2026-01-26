import type { FrontmatterData, PageData } from "./types.js";
export declare function isInternalLink(target: HTMLAnchorElement): boolean;
export declare function findAnchorElement(element: HTMLElement | null): HTMLAnchorElement | null;
export declare function updateMetaTags(frontmatter: FrontmatterData): void;
export declare function executeScripts(container: HTMLElement): void;
export declare function applyHeadDirectives(container: HTMLElement): void;
export declare function manageFocus(container: HTMLElement): void;
export declare function extractPageDataFromScript(): PageData | null;
export declare function parsePageDataFromHTML(html: string): {
    content: string;
    pageData: PageData;
};
//# sourceMappingURL=dom-utils.d.ts.map