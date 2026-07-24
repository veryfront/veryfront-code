declare const brand: unique symbol;

/** Adds a nominal brand to a base type without changing its runtime representation. */
export type Brand<T, TBrand extends string> = T & {
  readonly [brand]: {
    readonly name: TBrand;
    readonly base: T;
  };
};

/** Identifier for a content entity. */
export type EntityId = Brand<string, "EntityId">;
/** Identifier for a resource. */
export type ResourceId = Brand<string, "ResourceId">;
/** Identifier for a tool definition. */
export type ToolId = Brand<string, "ToolId">;
/** Identifier for a prompt definition. */
export type PromptId = Brand<string, "PromptId">;

/** Identifier for a user. */
export type UserId = Brand<string, "UserId">;
/** Identifier for an agent. */
export type AgentId = Brand<string, "AgentId">;
/** Identifier for a session. */
export type SessionId = Brand<string, "SessionId">;

/** Canonical route or content slug. */
export type Slug = Brand<string, "Slug">;
/** Identifier for a page. */
export type PageId = Brand<string, "PageId">;
/** Identifier for a layout. */
export type LayoutId = Brand<string, "LayoutId">;

/** Identifier for an HTTP or runtime request. */
export type RequestId = Brand<string, "RequestId">;
/** Identifier for an agent tool call. */
export type ToolCallId = Brand<string, "ToolCallId">;
/** Identifier for a conversation message. */
export type MessageId = Brand<string, "MessageId">;

/** Authentication token whose value must not be logged or exposed. */
export type AuthToken = Brand<string, "AuthToken">;
/** Cross-site request forgery token. */
export type CsrfToken = Brand<string, "CsrfToken">;
/** API key whose value must not be logged or exposed. */
export type ApiKey = Brand<string, "ApiKey">;

/** Recovers the base type from a value created with {@link Brand}. */
export type Unbrand<T> = T extends { readonly [brand]: { readonly base: infer U } } ? U : T;
