/**
 * Markdown Component - Rich markdown renderer for chat messages
 *
 * Supports:
 * - GitHub Flavored Markdown (tables, strikethrough, etc.)
 * - Syntax highlighted code blocks
 * - Mermaid diagrams (lazy loaded, client-side only)
 *
 * Works in: Deno, Node.js, Bun (client-side React)
 */
import * as dntShim from "../../../../_dnt.shims.js";
import * as React from "react";
import { cn } from "./theme.js";
const isBrowser = typeof dntShim.dntGlobalThis !== "undefined" && typeof document !== "undefined";
const ESM_REACT_MARKDOWN = "https://esm.sh/react-markdown@9?external=react&target=es2022";
const ESM_REMARK_GFM = "https://esm.sh/remark-gfm@4?target=es2022";
const ESM_REHYPE_HIGHLIGHT = "https://esm.sh/rehype-highlight@7?target=es2022";
const ESM_MERMAID = "https://esm.sh/mermaid@11";
const dynamicImport = new Function("url", "return import(url)");
// deno-lint-ignore no-explicit-any
let ReactMarkdown = null;
// deno-lint-ignore no-explicit-any
let remarkGfm = null;
// deno-lint-ignore no-explicit-any
let rehypeHighlight = null;
// deno-lint-ignore no-explicit-any
let mermaidPromise = null;
// deno-lint-ignore no-explicit-any
let mermaidModule = null;
async function loadMermaid() {
    if (!isBrowser)
        return null;
    if (mermaidModule)
        return mermaidModule;
    mermaidPromise ??= dynamicImport(ESM_MERMAID);
    mermaidModule = await mermaidPromise;
    mermaidModule.default.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
    });
    return mermaidModule;
}
function MermaidDiagram({ code }) {
    const [svg, setSvg] = React.useState("");
    const [error, setError] = React.useState("");
    React.useEffect(() => {
        if (!isBrowser)
            return;
        let cancelled = false;
        async function render() {
            try {
                const mermaid = await loadMermaid();
                if (!mermaid)
                    return;
                const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
                const { svg: renderedSvg } = await mermaid.default.render(id, code);
                if (cancelled)
                    return;
                setSvg(renderedSvg);
                setError("");
            }
            catch (error) {
                if (cancelled)
                    return;
                setError(error instanceof Error ? error.message : "Failed to render diagram");
            }
        }
        render();
        return () => {
            cancelled = true;
        };
    }, [code]);
    if (!isBrowser) {
        return (React.createElement("pre", { className: "my-4 p-4 bg-neutral-100 dark:bg-neutral-800 rounded-lg overflow-auto" },
            React.createElement("code", null, code)));
    }
    if (error) {
        return (React.createElement("div", { className: "my-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 text-sm" },
            React.createElement("p", { className: "font-medium" }, "Mermaid Error"),
            React.createElement("p", null, error),
            React.createElement("pre", { className: "mt-2 text-xs overflow-auto" }, code)));
    }
    if (!svg) {
        return (React.createElement("div", { className: "my-4 p-4 bg-neutral-100 dark:bg-neutral-800 rounded-lg animate-pulse" },
            React.createElement("div", { className: "h-32 flex items-center justify-center text-neutral-400" }, "Loading diagram...")));
    }
    return (React.createElement("div", { className: "my-4 flex justify-center overflow-auto", dangerouslySetInnerHTML: { __html: svg } }));
}
function CodeBlock({ language, code, inline, enableMermaid, renderCodeBlock, }) {
    if (renderCodeBlock) {
        return React.createElement(React.Fragment, null, renderCodeBlock({ language, code, inline }));
    }
    if (inline) {
        return (React.createElement("code", { className: "bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono" }, code));
    }
    if (enableMermaid && language === "mermaid") {
        return React.createElement(MermaidDiagram, { code: code });
    }
    return (React.createElement("pre", { className: "my-4 p-4 bg-neutral-900 dark:bg-neutral-950 rounded-lg overflow-auto" },
        React.createElement("code", { className: language ? `language-${language} hljs` : "hljs" }, code)));
}
export function Markdown({ children, className, enableMermaid = true, renderCodeBlock, }) {
    const [isLoaded, setIsLoaded] = React.useState(false);
    const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => {
        async function load() {
            if (!ReactMarkdown) {
                const [rmModule, gfmModule, highlightModule] = await Promise.all([
                    dynamicImport(ESM_REACT_MARKDOWN),
                    dynamicImport(ESM_REMARK_GFM),
                    dynamicImport(ESM_REHYPE_HIGHLIGHT),
                ]);
                ReactMarkdown = rmModule.default;
                remarkGfm = gfmModule.default;
                rehypeHighlight = highlightModule.default;
            }
            setIsLoaded(true);
            forceUpdate();
        }
        load();
    }, []);
    if (!isLoaded || !ReactMarkdown) {
        return (React.createElement("div", { className: cn("prose prose-sm dark:prose-invert max-w-none", className) },
            React.createElement("p", { className: "whitespace-pre-wrap" }, children)));
    }
    return (React.createElement("div", { className: cn("prose prose-sm dark:prose-invert max-w-none", className) },
        React.createElement(ReactMarkdown, { remarkPlugins: remarkGfm ? [remarkGfm] : [], rehypePlugins: rehypeHighlight ? [rehypeHighlight] : [], components: {
                // deno-lint-ignore no-explicit-any
                code(props) {
                    const { className: codeClassName, children: codeChildren, node } = props;
                    const match = /language-(\w+)/.exec(codeClassName || "");
                    const language = match ? match[1] : undefined;
                    const code = String(codeChildren).replace(/\n$/, "");
                    const isInline = !node?.position?.start?.line;
                    return (React.createElement(CodeBlock, { language: language, code: code, inline: isInline, enableMermaid: enableMermaid, renderCodeBlock: renderCodeBlock }));
                },
                // deno-lint-ignore no-explicit-any
                table(props) {
                    return (React.createElement("div", { className: "my-4 overflow-auto" },
                        React.createElement("table", { className: "min-w-full divide-y divide-neutral-200 dark:divide-neutral-700" }, props.children)));
                },
                // deno-lint-ignore no-explicit-any
                a(props) {
                    return (React.createElement("a", { href: props.href, className: "text-blue-600 dark:text-blue-400 hover:underline", target: "_blank", rel: "noopener noreferrer" }, props.children));
                },
                // deno-lint-ignore no-explicit-any
                blockquote(props) {
                    return (React.createElement("blockquote", { className: "border-l-4 border-neutral-300 dark:border-neutral-600 pl-4 my-4 text-neutral-600 dark:text-neutral-400 italic" }, props.children));
                },
            } }, children)));
}
export default Markdown;
