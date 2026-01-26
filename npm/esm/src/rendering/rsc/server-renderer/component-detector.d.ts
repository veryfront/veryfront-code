import type * as React from "react";
import type { ClientComponentMeta } from "../types.js";
export type RSCComponent = React.ComponentType<any> & {
    __rsc_client?: boolean;
    __rsc_id?: string;
    __rsc_path?: string;
    displayName?: string;
    name?: string;
    $$typeof?: symbol;
};
export declare function isClientComponent(Component: RSCComponent, clientManifest: Map<string, ClientComponentMeta>): boolean;
export declare function getComponentId(Component: RSCComponent): string;
export declare function registerClientRef(id: string, Component: RSCComponent, clientManifest: Map<string, ClientComponentMeta>, clientRefs: Map<string, string>): void;
//# sourceMappingURL=component-detector.d.ts.map