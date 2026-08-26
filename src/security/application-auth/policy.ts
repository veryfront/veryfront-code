/** Maximum number of scopes accepted by the application OIDC runtime. */
export const MAX_APPLICATION_AUTH_SCOPE_COUNT = 32;

/** Maximum length of one application OIDC scope. */
export const MAX_APPLICATION_AUTH_SCOPE_LENGTH = 128;

/** Maximum length of a trusted-proxy identity header name. */
export const MAX_APPLICATION_IDENTITY_HEADER_NAME_LENGTH = 128;

const apply = Reflect.apply;
const stringStartsWith = String.prototype.startsWith;
const stringToLowerCase = String.prototype.toLowerCase;

/** Whether an HTTP header name is reserved for transport identity. */
export function isForbiddenApplicationIdentityHeaderName(value: string): boolean {
  const name = apply(stringToLowerCase, value, []) as string;
  return name === "host" ||
    name === "forwarded" ||
    name === "via" ||
    name === "x-real-ip" ||
    (apply(stringStartsWith, name, ["x-forwarded-"]) as boolean);
}
