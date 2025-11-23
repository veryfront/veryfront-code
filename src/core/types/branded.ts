/**
 * Branded types for domain-specific primitives
 *
 * Branded types provide compile-time safety by making primitive types
 * nominally distinct, preventing accidental misuse of semantically
 * different values that happen to share the same underlying type.
 *
 * @example
 * ```ts
 * // Without branded types - unsafe
 * function getUser(userId: string) { ... }
 * const postId = "post-123";
 * getUser(postId); // Compiles but semantically wrong!
 *
 * // With branded types - type-safe
 * function getUser(userId: UserId) { ... }
 * const postId = "post-123" as PostId;
 * getUser(postId); // Type error! Cannot assign PostId to UserId
 * ```
 */

/**
 * Brand symbol for nominal typing
 */
declare const brand: unique symbol;

/**
 * Brand a primitive type with a unique identifier
 */
export type Brand<T, TBrand extends string> = T & {
  readonly [brand]: TBrand;
};

/**
 * Entity/Resource identifiers
 */
export type EntityId = Brand<string, "EntityId">;
export type ResourceId = Brand<string, "ResourceId">;
export type ToolId = Brand<string, "ToolId">;
export type PromptId = Brand<string, "PromptId">;

/**
 * User/Agent identifiers
 */
export type UserId = Brand<string, "UserId">;
export type AgentId = Brand<string, "AgentId">;
export type SessionId = Brand<string, "SessionId">;

/**
 * Content identifiers
 */
export type Slug = Brand<string, "Slug">;
export type PageId = Brand<string, "PageId">;
export type LayoutId = Brand<string, "LayoutId">;

/**
 * Request/Response identifiers
 */
export type RequestId = Brand<string, "RequestId">;
export type ToolCallId = Brand<string, "ToolCallId">;
export type MessageId = Brand<string, "MessageId">;

/**
 * Security tokens
 */
export type AuthToken = Brand<string, "AuthToken">;
export type CsrfToken = Brand<string, "CsrfToken">;
export type ApiKey = Brand<string, "ApiKey">;

/**
 * Helper to create branded values (for runtime use)
 *
 * @example
 * ```ts
 * const userId = brandValue<UserId>("user-123");
 * const slug = brandValue<Slug>("/blog/post-1");
 * ```
 */
export function brandValue<T extends Brand<string, string>>(value: string): T {
  return value as T;
}

/**
 * Type guard to check if a value is a specific branded type
 * Note: This only performs runtime string validation, not brand checking
 */
export function isBrandedString(value: unknown): value is Brand<string, string> {
  return typeof value === "string";
}

/**
 * Extract the underlying primitive from a branded type
 */
export type Unbrand<T> = T extends Brand<infer U, string> ? U : T;

/**
 * Helper to safely unwrap branded values
 */
export function unbrandValue<T extends Brand<string, string>>(value: T): string {
  return value as string;
}
