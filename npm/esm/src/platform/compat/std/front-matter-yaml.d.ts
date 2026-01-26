/**
 * Portable @std/front-matter/yaml shim.
 * Uses gray-matter for consistent, feature-complete parsing across runtimes.
 *
 * @module
 */
export interface Extract<T> {
    attrs: T;
    body: string;
    frontMatter: string;
}
export declare function extract<T = Record<string, unknown>>(text: string): Extract<T>;
export declare function test(text: string): boolean;
//# sourceMappingURL=front-matter-yaml.d.ts.map