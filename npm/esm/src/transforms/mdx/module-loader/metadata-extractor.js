import { rendererLogger as logger } from "../../../utils/index.js";
import { extractBalancedBlock, parseJsonish } from "./string-parser.js";
export function extractFrontmatter(moduleCode) {
    try {
        const fmIndex = moduleCode.search(/(?:export\s+)?const\s+frontmatter\s*=\s*/);
        if (fmIndex < 0)
            return undefined;
        const braceStart = moduleCode.indexOf("{", fmIndex);
        if (braceStart < 0)
            return undefined;
        const raw = extractBalancedBlock(moduleCode, braceStart, "{", "}");
        if (!raw)
            return undefined;
        const jsonish = raw
            .replace(/([^\s"{[:,]+)\s*:/g, '"$1":')
            .replace(/'([^']*)'/g, '"$1"');
        try {
            return JSON.parse(jsonish);
        }
        catch (e) {
            logger.debug("[mdx] frontmatter JSON parse failed", e);
            return undefined;
        }
    }
    catch (e) {
        logger.debug("[mdx] frontmatter extraction failed", e);
        return undefined;
    }
}
const METADATA_PATTERNS = [
    { regex: /(?:export\s+)?const\s+title\s*=\s*["']([^"']+)["']/, key: "title" },
    { regex: /(?:export\s+)?const\s+description\s*=\s*["']([^"']+)["']/, key: "description" },
    { regex: /(?:export\s+)?const\s+layout\s*=\s*(true|false|["'][^"']+["'])/, key: "layout" },
    { regex: /(?:export\s+)?const\s+headings\s*=\s*(\[[\s\S]*?\])/, key: "headings" },
    { regex: /(?:export\s+)?const\s+nested\s*=\s*({[\s\S]*?})/, key: "nested" },
    { regex: /(?:export\s+)?const\s+tags\s*=\s*(\[[\s\S]*?\])/, key: "tags" },
    { regex: /(?:export\s+)?const\s+date\s*=\s*["']([^"']+)["']/, key: "date" },
    { regex: /(?:export\s+)?const\s+draft\s*=\s*(true|false)/, key: "draft" },
];
function parseLayoutValue(value) {
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    return value.replace(/^"|"$/g, "");
}
export function extractMetadata(moduleCode) {
    const exports = {};
    for (const { regex, key } of METADATA_PATTERNS) {
        const match = moduleCode.match(regex);
        if (!match)
            continue;
        const value = match[1];
        switch (key) {
            case "title":
            case "description":
            case "date":
                exports[key] = value;
                break;
            case "draft":
                exports[key] = value === "true";
                break;
            case "layout":
                if (value !== undefined)
                    exports[key] = parseLayoutValue(value);
                break;
            default:
                try {
                    if (value !== undefined)
                        exports[key] = parseJsonish(value);
                }
                catch (e) {
                    logger.warn(`Failed to parse ${String(key)}`, e);
                }
                break;
        }
    }
    return exports;
}
const FRONTMATTER_KEYS = [
    "title",
    "description",
    "layout",
    "headings",
    "tags",
    "date",
    "draft",
    "nested",
];
export function mergeFrontmatter(result) {
    result.frontmatter ??= {};
    for (const key of FRONTMATTER_KEYS) {
        const value = result[key];
        if (value !== undefined && result.frontmatter[key] === undefined) {
            result.frontmatter[key] = value;
        }
    }
}
