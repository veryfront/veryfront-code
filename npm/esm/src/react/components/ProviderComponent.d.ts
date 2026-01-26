import type * as React from "react";
import type { MDXComponents } from "../../types/index.js";
import type { MdxBundle } from "./LayoutComponent.js";
export interface ProviderComponentProps {
    mdxBundle: MdxBundle;
    children: React.ReactNode;
    components?: MDXComponents;
}
export declare function ProviderComponent({ mdxBundle, children, components, }: ProviderComponentProps): React.ReactElement;
//# sourceMappingURL=ProviderComponent.d.ts.map