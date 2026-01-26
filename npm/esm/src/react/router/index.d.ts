import "../../../_dnt.polyfills.js";
import "../../../_dnt.polyfills.js";
import React from "react";
export interface RouterValue {
    domain: string;
    path: string;
    pathname: string;
    params: Record<string, string>;
    query: Record<string, string>;
    isPreview: boolean;
    isMounted: boolean;
    navigate: (url: string) => Promise<void>;
    push: (url: string) => Promise<void>;
    replace: (url: string) => Promise<void>;
    reload: () => Promise<void>;
}
export interface RouterProviderProps {
    children: React.ReactNode;
    router?: RouterValue;
}
export declare function RouterProvider({ children, router, }: RouterProviderProps): React.ReactElement;
export declare function useRouter(): RouterValue;
export { RouterProvider as Router };
//# sourceMappingURL=index.d.ts.map