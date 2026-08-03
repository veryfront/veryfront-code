import type { ToolExecutionContext } from "#veryfront/tool";
import { isCanonicalOpaqueProjectIdentifier } from "#veryfront/utils/project-identity.ts";

const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const StringPrototypeTrim = String.prototype.trim;
const MAX_TOOL_EXECUTION_AUTH_TOKEN_CHARACTERS = 16_384;
const VISIBLE_ASCII_AUTH_TOKEN_PATTERN = /^[\x21-\x7e]+$/;
const MISSING_EXECUTION_IDENTITY_PROPERTY = Symbol(
  "missing-execution-identity-property",
);
const UNREADABLE_EXECUTION_IDENTITY_PROPERTY = Symbol(
  "unreadable-execution-identity-property",
);

/** Confirmed request credential identity used by first-party remote tools. */
export type ConfirmedToolExecutionIdentity = {
  authToken: string;
  projectId: string | null;
};

type ResolvedToolExecutionAuthToken = {
  authToken: string;
  fromContext: boolean;
};

function readExecutionIdentityOwnDataProperty(
  context: ToolExecutionContext | undefined,
  property: "authToken" | "projectId",
):
  | unknown
  | typeof MISSING_EXECUTION_IDENTITY_PROPERTY
  | typeof UNREADABLE_EXECUTION_IDENTITY_PROPERTY {
  if (context === undefined) {
    return MISSING_EXECUTION_IDENTITY_PROPERTY;
  }

  try {
    const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      context,
      property,
    ]) as PropertyDescriptor | undefined;
    if (!descriptor) {
      return MISSING_EXECUTION_IDENTITY_PROPERTY;
    }
    if (!ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, ["value"])) {
      return UNREADABLE_EXECUTION_IDENTITY_PROPERTY;
    }
    return descriptor.value;
  } catch {
    return UNREADABLE_EXECUTION_IDENTITY_PROPERTY;
  }
}

function normalizeAuthToken(value: unknown, errorContext: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TOOL_EXECUTION_AUTH_TOKEN_CHARACTERS ||
    ReflectApply(StringPrototypeTrim, value, []) !== value ||
    !VISIBLE_ASCII_AUTH_TOKEN_PATTERN.test(value)
  ) {
    throw new TypeError(`${errorContext} authToken is invalid`);
  }
  return value;
}

/** Resolve an own request auth token, falling back only when the property is absent. */
export function resolveToolExecutionAuthToken(
  context: ToolExecutionContext | undefined,
  fallbackAuthToken: string,
  errorContext: string,
): ResolvedToolExecutionAuthToken {
  const authToken = readExecutionIdentityOwnDataProperty(context, "authToken");
  if (authToken === MISSING_EXECUTION_IDENTITY_PROPERTY) {
    return {
      authToken: normalizeAuthToken(fallbackAuthToken, errorContext),
      fromContext: false,
    };
  }
  if (authToken === UNREADABLE_EXECUTION_IDENTITY_PROPERTY) {
    throw new TypeError(`${errorContext} authToken is unreadable`);
  }
  return {
    authToken: normalizeAuthToken(authToken, errorContext),
    fromContext: true,
  };
}

/** Resolve project identity from the same execution context as its credential. */
export function resolveToolExecutionProjectId(
  context: ToolExecutionContext | undefined,
  getFallbackProjectId: (() => unknown) | undefined,
  errorContext: string,
): string | null {
  if (context === undefined) {
    return normalizeToolExecutionProjectId(
      getFallbackProjectId?.(),
      errorContext,
    );
  }

  const projectId = readExecutionIdentityOwnDataProperty(context, "projectId");
  if (projectId === UNREADABLE_EXECUTION_IDENTITY_PROPERTY) {
    throw new TypeError(`${errorContext} projectId is unreadable`);
  }
  if (projectId === MISSING_EXECUTION_IDENTITY_PROPERTY) {
    return null;
  }
  return normalizeToolExecutionProjectId(projectId, errorContext);
}

/**
 * Resolve authorization and project as one credential-owned tuple.
 *
 * A context that owns `authToken` also owns project selection; an absent
 * project is therefore explicitly projectless. Without an own auth token, the
 * complete configured tuple is used so credentials and project identity cannot
 * be combined from different authorities.
 */
export function resolveToolExecutionIdentity(
  context: ToolExecutionContext | undefined,
  fallbackAuthToken: string,
  getFallbackProjectId: (() => unknown) | undefined,
  errorContext: string,
): ConfirmedToolExecutionIdentity {
  const resolvedAuth = resolveToolExecutionAuthToken(
    context,
    fallbackAuthToken,
    errorContext,
  );
  if (!resolvedAuth.fromContext) {
    return {
      authToken: resolvedAuth.authToken,
      projectId: resolveToolExecutionProjectId(
        undefined,
        getFallbackProjectId,
        errorContext,
      ),
    };
  }

  return {
    authToken: resolvedAuth.authToken,
    projectId: resolveToolExecutionProjectId(
      context,
      undefined,
      errorContext,
    ),
  };
}

/** Validate an optional outbound project identifier. */
export function normalizeToolExecutionProjectId(
  projectId: unknown,
  errorContext: string,
): string | null {
  if (projectId === null || projectId === undefined) {
    return null;
  }
  if (!isCanonicalOpaqueProjectIdentifier(projectId)) {
    throw new TypeError(`${errorContext} projectId is invalid`);
  }
  return projectId;
}

/**
 * Snapshot own data context without invoking accessors, then bind credential
 * identity as authoritative own data.
 */
export function bindToolExecutionIdentityContext(
  context: ToolExecutionContext | undefined,
  identity: ConfirmedToolExecutionIdentity,
  errorContext: string,
): ToolExecutionContext | undefined {
  if (context === undefined) {
    return undefined;
  }

  const nextContext: ToolExecutionContext = {};
  try {
    const keys = ReflectApply(ReflectOwnKeys, undefined, [context]) as PropertyKey[];
    for (const key of keys) {
      if (key === "authToken" || key === "projectId") {
        continue;
      }
      const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
        context,
        key,
      ]) as PropertyDescriptor | undefined;
      if (
        !descriptor ||
        !ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, ["value"])
      ) {
        continue;
      }
      ReflectApply(ObjectDefineProperty, undefined, [
        nextContext,
        key,
        {
          configurable: true,
          enumerable: descriptor.enumerable ?? false,
          value: descriptor.value,
          writable: true,
        },
      ]);
    }

    ReflectApply(ObjectDefineProperty, undefined, [
      nextContext,
      "authToken",
      {
        configurable: true,
        enumerable: true,
        value: identity.authToken,
        writable: true,
      },
    ]);
    if (identity.projectId !== null) {
      ReflectApply(ObjectDefineProperty, undefined, [
        nextContext,
        "projectId",
        {
          configurable: true,
          enumerable: true,
          value: identity.projectId,
          writable: true,
        },
      ]);
    }
  } catch {
    throw new TypeError(`${errorContext} is unreadable`);
  }

  return nextContext;
}
