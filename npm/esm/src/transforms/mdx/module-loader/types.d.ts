import type * as React from "react";
export interface MDXComponentProps {
    [key: string]: unknown;
    children?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}
export interface MDXContentProps {
    components?: Record<string, React.ComponentType<MDXComponentProps>>;
    [key: string]: unknown;
}
export interface FrontmatterMetadata {
    title?: string;
    description?: string;
    layout?: string | boolean;
    headings?: Array<{
        text: string;
        level: number;
        id?: string;
    }>;
    tags?: string[];
    date?: string;
    draft?: boolean;
    nested?: Record<string, unknown>;
    [key: string]: unknown;
}
export interface MDXModule {
    default?: React.ComponentType<MDXContentProps>;
    MDXContent?: React.ComponentType<MDXContentProps>;
    MDXWrapper?: React.ComponentType<MDXContentProps>;
    frontmatter?: FrontmatterMetadata;
    title?: string;
    description?: string;
    layout?: string | boolean;
    headings?: Array<{
        text: string;
        level: number;
        id?: string;
    }>;
    [key: string]: unknown;
}
export interface LogContext {
    [key: string]: unknown;
}
export interface Adapter {
    fs: {
        readFile: (path: string) => Promise<string>;
        writeFile: (path: string, content: string) => Promise<void>;
        makeTempDir: (prefix: string) => Promise<string>;
    };
}
//# sourceMappingURL=types.d.ts.map