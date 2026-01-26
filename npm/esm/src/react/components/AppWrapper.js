import * as React from "react";
import { LayoutComponent } from "./LayoutComponent.js";
import { ProviderComponent } from "./ProviderComponent.js";
export function AppWrapper({ children, providers = [], layout, components = {}, pageContext, }) {
    let content = children;
    if (layout) {
        content = (React.createElement(LayoutComponent, { mdxBundle: layout, components: components, pageContext: pageContext }, content));
    }
    for (let i = providers.length - 1; i >= 0; i--) {
        const provider = providers[i];
        if (!provider)
            continue;
        content = (React.createElement(ProviderComponent, { mdxBundle: provider, components: components }, content));
    }
    return content;
}
