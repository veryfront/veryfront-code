import type React from "react";
import type { MdxBundle, MDXComponents, PageContext as TypedPageContext } from "../../types/index.js";
export type { MdxBundle } from "../../types/index.js";
export interface LayoutComponentProps {
    mdxBundle: MdxBundle;
    children: React.ReactNode;
    components?: MDXComponents;
    pageContext?: TypedPageContext;
}
export declare function LayoutComponent({ mdxBundle, children, components, pageContext, }: LayoutComponentProps): React.ReactElement;
//# sourceMappingURL=LayoutComponent.d.ts.map