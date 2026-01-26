/**
 * Portable @std/front-matter/yaml shim.
 * Uses gray-matter for consistent, feature-complete parsing across runtimes.
 *
 * @module
 */
import grayMatterImport from "gray-matter";
const grayMatter = grayMatterImport.default ??
    grayMatterImport;
export function extract(text) {
    const result = grayMatter(text);
    return {
        attrs: result.data,
        body: result.content,
        frontMatter: result.matter ?? "",
    };
}
export function test(text) {
    const testFn = grayMatter.test;
    if (typeof testFn === "function")
        return testFn(text);
    return /^---\r?\n/.test(text);
}
