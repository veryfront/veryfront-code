/**
 * Filters props for client components, removing children and non-serializable values.
 */
export declare function serializeProps(props: Record<string, unknown>): Record<string, unknown>;
/**
 * Stringify props with safe handling of circular references.
 */
export declare function stringifyProps(props: Record<string, unknown>): string;
//# sourceMappingURL=prop-serializer.d.ts.map