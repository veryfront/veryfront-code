import type { BrowserTargets } from "../../../types/index.js";
export declare function findCSSFiles(dir: string): Promise<string[]>;
export declare function globFiles(pattern: string): Promise<string[]>;
export declare function matchPattern(path: string, pattern: string): boolean;
export declare function getOutputPath(inputPath: string, outputDir: string): string;
export declare function extractSelectors(content: string): {
    classes: string[];
    ids: string[];
    tags: string[];
    selectors: Set<string>;
};
export declare function extractSelectorsFromHTML(html: string): string[];
export declare function shouldKeepSelector(selector: string, usedSelectors: Set<string>): boolean;
export declare function basicMinify(css: string): string;
export declare function calculateSavings(originalSize: number, minifiedSize: number): number;
export declare function parseBrowserTargets(targets: string | string[] | BrowserTargets | undefined): BrowserTargets | undefined;
//# sourceMappingURL=utils.d.ts.map