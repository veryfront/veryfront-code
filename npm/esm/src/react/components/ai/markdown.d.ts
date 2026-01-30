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
import * as React from "react";
export interface MarkdownProps {
    /** Markdown content to render */
    children: string;
    /** Additional class name */
    className?: string;
    /** Enable mermaid diagram rendering (default: true, client-side only) */
    enableMermaid?: boolean;
    /** Custom code block renderer */
    renderCodeBlock?: (props: CodeBlockProps) => React.ReactNode;
}
export interface CodeBlockProps {
    language: string | undefined;
    code: string;
    inline?: boolean;
}
export declare function Markdown({ children, className, enableMermaid, renderCodeBlock, }: MarkdownProps): React.ReactElement;
export default Markdown;
//# sourceMappingURL=markdown.d.ts.map