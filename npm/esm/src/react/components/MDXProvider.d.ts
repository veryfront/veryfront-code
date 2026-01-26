import React from "react";
import type { MDXComponents } from "../../types/index.js";
export interface MDXProviderProps {
    components?: MDXComponents;
    children: React.ReactNode;
}
export declare function MDXProvider({ components, children, }: MDXProviderProps): React.ReactNode;
export declare function useMDXComponents(components?: MDXComponents): MDXComponents;
//# sourceMappingURL=MDXProvider.d.ts.map