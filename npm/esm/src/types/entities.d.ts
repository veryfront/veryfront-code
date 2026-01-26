import { z } from "zod";
export interface Frontmatter {
    title?: string;
    description?: string;
    layout?: string;
    tags?: string[];
    date?: string;
    published?: boolean;
    [key: string]: string | number | boolean | string[] | undefined;
}
export interface BundleInfo {
    id: string;
    path: string;
    size?: number;
    hash?: string;
    dependencies?: string[];
    exports?: string[];
    compiled?: boolean;
    timestamp?: Date;
}
export interface LoaderData {
    props?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    error?: string;
    timestamp?: Date;
}
export interface Entity {
    id: string;
    path: string;
    slug: string;
    type: "page" | "layout" | "component";
    content: string;
    frontmatter: Frontmatter;
    kind?: "mdx" | "tsx";
    isLayout?: boolean;
    isComponent?: boolean;
    isPage?: boolean;
}
export interface EntityInfo {
    entity: Entity;
    bundle?: BundleInfo | null;
    loaderData?: LoaderData | null;
}
export interface EntityTypeInfo {
    type: Entity["type"];
    kind?: "mdx" | "tsx";
    isLayout: boolean;
    isComponent: boolean;
    isPage: boolean;
}
/**
 * Zod schema for Frontmatter validation.
 */
export declare const FrontmatterSchema: z.ZodType<Frontmatter>;
/**
 * Zod schema for Entity validation.
 * Used to catch programming errors early when entities are created or transformed.
 */
export declare const EntitySchema: z.ZodType<Entity>;
/**
 * Validate an Entity object and throw if invalid.
 * Use this at system boundaries where entities are created from external data.
 */
export declare function validateEntity(entity: unknown): Entity;
/**
 * Safely validate an Entity, returning result or null.
 * Use for optional validation where you want to handle errors gracefully.
 */
export declare function safeValidateEntity(entity: unknown): Entity | null;
export declare function detectEntityType(fileName: string, frontmatter?: Frontmatter): EntityTypeInfo;
//# sourceMappingURL=entities.d.ts.map