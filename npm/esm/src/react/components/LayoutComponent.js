import { useMemo, useRef } from "react";
import { mdxRenderer } from "../../transforms/mdx/index.js";
import { rendererLogger as logger } from "../../utils/index.js";
function useStableObject(obj) {
    const ref = useRef(obj);
    const prevSerialized = useRef(JSON.stringify(obj));
    const serialized = JSON.stringify(obj);
    if (prevSerialized.current !== serialized) {
        ref.current = obj;
        prevSerialized.current = serialized;
    }
    return ref.current;
}
export function LayoutComponent({ mdxBundle, children, components = {}, pageContext, }) {
    const stableFrontmatter = useStableObject(mdxBundle.frontmatter);
    const stablePageContext = useStableObject(pageContext);
    const fallback = React.createElement(React.Fragment, null, children);
    const element = useMemo(() => {
        try {
            return mdxRenderer.render(mdxBundle.compiledCode, {
                components,
                frontmatter: { ...(stableFrontmatter ?? {}), pageContext: stablePageContext },
                globals: mdxBundle.globals,
                extractLayout: true,
                children,
            });
        }
        catch (error) {
            logger.error("[LayoutComponent] Render failed:", error);
            return fallback;
        }
    }, [
        mdxBundle.compiledCode,
        mdxBundle.globals,
        components,
        children,
        stableFrontmatter,
        stablePageContext,
    ]);
    return element || fallback;
}
