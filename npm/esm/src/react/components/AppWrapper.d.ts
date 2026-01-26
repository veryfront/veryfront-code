import * as React from "react";
import type { MDXComponents, PageContext as TypedPageContext } from "../../types/index.js";
import type { MdxBundle } from "./LayoutComponent.js";
export interface AppWrapperProps {
    children: React.ReactNode;
    providers?: MdxBundle[];
    layout?: MdxBundle;
    components?: MDXComponents;
    mode?: string;
    studioEnabled?: boolean;
    pageContext?: TypedPageContext;
}
export declare function AppWrapper({ children, providers, layout, components, pageContext, }: AppWrapperProps): React.ReactNode;
//# sourceMappingURL=AppWrapper.d.ts.map