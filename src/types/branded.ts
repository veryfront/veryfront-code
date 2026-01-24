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

export function brandValue<T extends Brand<string, string>>(value: string): T {
  return value as T;
}

export function isBrandedString(value: unknown): value is Brand<string, string> {
  return typeof value === "string";
}

export type Unbrand<T> = T extends Brand<infer U, string> ? U : T;

export function unbrandValue<T extends Brand<string, string>>(value: T): string {
  return value;
}
