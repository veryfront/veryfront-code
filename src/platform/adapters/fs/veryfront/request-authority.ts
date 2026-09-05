import { currentRequestContext } from "#veryfront/platform/request-context-access.ts";

const requestAuthoritySalt = crypto.randomUUID();
const intrinsicApply = Reflect.apply;
const intrinsicBigInt = BigInt;
const stringCodePointAt = String.prototype.codePointAt;
const bigintToString = BigInt.prototype.toString;

function foldAuthority(value: string): string {
  const FNV_OFFSET_BASIS = 14695981039346656037n;
  const FNV_PRIME = 1099511628211n;
  const MASK_64 = (1n << 64n) - 1n;
  let hash = FNV_OFFSET_BASIS;
  for (let offset = 0; offset < value.length;) {
    const codePoint = intrinsicApply(stringCodePointAt, value, [offset]) as number;
    offset += codePoint > 0xFFFF ? 2 : 1;
    hash ^= intrinsicBigInt(codePoint);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return intrinsicApply(bigintToString, hash, [36]) as string;
}

export function requestAuthorityFingerprint(token: string): string {
  const first = foldAuthority(`read-authority:a:${requestAuthoritySalt}:${token}`);
  const second = foldAuthority(`read-authority:b:${requestAuthoritySalt}:${token}`);
  return `${first}${second}`;
}

export function getRequestAuthorityCacheVariant(): string | undefined {
  const token = currentRequestContext()?.token;
  return token ? `authority:${requestAuthorityFingerprint(token)}` : undefined;
}

export function scopeToRequestAuthority(scope: string): string {
  const authority = getRequestAuthorityCacheVariant();
  return authority ? `${scope}|${authority.length}:${authority}` : scope;
}
