import type React from "react";
export type MDXComponents = Record<string, React.ComponentType<unknown>>;
export interface MDXComponentProps {
    components?: MDXComponents;
    children?: React.ReactNode;
}
export interface MDXFrontmatter {
    title?: string;
    description?: string;
    layout?: string | boolean;
    headings?: Array<{
        text: string;
        level: number;
    }>;
    metadata?: Record<string, unknown>;
    og?: Record<string, string>;
    twitter?: Record<string, string>;
    meta?: Array<{
        name?: string;
        property?: string;
        content: string;
    }>;
    links?: Array<{
        rel: string;
        href: string;
        [key: string]: string;
    }>;
    icons?: Array<{
        href: string;
        rel?: string;
        sizes?: string;
        type?: string;
    }>;
    scripts?: Array<{
        src?: string;
        content?: string;
        [key: string]: string | undefined;
    }>;
    styles?: Array<{
        href?: string;
        content?: string;
        [key: string]: string | undefined;
    }>;
    viewport?: string;
    themeColor?: string;
    [key: string]: unknown;
}
export type MDXGlobals = Record<string, unknown>;
export interface MDXExports {
    frontmatter?: MDXFrontmatter;
    title?: string;
    description?: string;
    layout?: string | boolean;
    headings?: Array<{
        text: string;
        level: number;
    }>;
    [key: string]: unknown;
}
export interface MDXImportInfo {
    name: string;
    path: string;
    isDefault: boolean;
}
export interface ParsedMDX {
    code: string;
    imports: Map<string, MDXImportInfo>;
    exports: MDXExports;
}
export interface MDXModule {
    default?: React.ComponentType<MDXComponentProps>;
    MDXContent?: React.ComponentType<MDXComponentProps>;
    MDXPage?: React.ComponentType<MDXComponentProps>;
    MDXWrapper?: React.ComponentType<MDXComponentProps>;
    MDXLayout?: React.ComponentType<MDXComponentProps>;
    MainLayout?: React.ComponentType<MDXComponentProps>;
    _createMdxContent?: React.ComponentType<MDXComponentProps>;
    frontmatter?: MDXFrontmatter;
    headings?: Array<{
        text: string;
        level: number;
    }>;
    title?: string;
    description?: string;
    layout?: string | boolean | React.ComponentType<MDXComponentProps>;
    [key: string]: unknown;
}
export type MDXModuleFactory = (React: typeof import("react"), Fragment: React.ComponentType, jsx: (...args: unknown[]) => unknown, jsxs: (...args: unknown[]) => unknown, jsxDEV: (...args: unknown[]) => unknown, components: MDXComponents, globals: MDXGlobals) => MDXModule;
export interface MDXExecutionContext {
    components: MDXComponents;
    globals: MDXGlobals;
    parsed: ParsedMDX;
}
export type HTMLMetadata = MDXFrontmatter;
//# sourceMappingURL=types.d.ts.map