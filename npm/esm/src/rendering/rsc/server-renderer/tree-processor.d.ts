import * as React from "react";
import type { ClientComponentMeta, RSCNode } from "../types.js";
/** Recursively renders a component tree to RSC nodes */
export declare function renderTree(Component: React.ComponentType<any> | React.ReactElement | string | number | null | undefined, props: Record<string, unknown>, clientManifest: Map<string, ClientComponentMeta>, clientRefs: Map<string, string>): Promise<RSCNode>;
/** Processes a React element into RSC node representation */
export declare function processElement(element: React.ReactElement, clientManifest: Map<string, ClientComponentMeta>, clientRefs: Map<string, string>): Promise<RSCNode>;
export declare function renderChildren(children: React.ReactNode, clientManifest: Map<string, ClientComponentMeta>, clientRefs: Map<string, string>): Promise<RSCNode[]>;
//# sourceMappingURL=tree-processor.d.ts.map