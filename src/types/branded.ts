declare const brand: unique symbol;

export type Brand<T, TBrand extends string> = T & {
  readonly [brand]: TBrand;
};

export type EntityId = Brand<string, "EntityId">;
export type ResourceId = Brand<string, "ResourceId">;
export type ToolId = Brand<string, "ToolId">;
export type PromptId = Brand<string, "PromptId">;

export type UserId = Brand<string, "UserId">;
export type AgentId = Brand<string, "AgentId">;
export type SessionId = Brand<string, "SessionId">;

export type Slug = Brand<string, "Slug">;
export type PageId = Brand<string, "PageId">;
export type LayoutId = Brand<string, "LayoutId">;

export type RequestId = Brand<string, "RequestId">;
export type ToolCallId = Brand<string, "ToolCallId">;
export type MessageId = Brand<string, "MessageId">;

export type AuthToken = Brand<string, "AuthToken">;
export type CsrfToken = Brand<string, "CsrfToken">;
export type ApiKey = Brand<string, "ApiKey">;

export type Unbrand<T> = T extends Brand<infer U, string> ? U : T;
