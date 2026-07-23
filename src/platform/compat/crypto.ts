import { NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";

/** Native Web Crypto subset exposed consistently by supported runtimes. */
export interface CryptoCompat {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID(): string;
  readonly subtle: SubtleCrypto;
}

interface NativeCryptoSnapshot {
  readonly getRandomValues: CallableFunction;
  readonly randomUUID: CallableFunction;
  readonly receiver: object;
  readonly subtle: SubtleCrypto;
}

class WebCryptoCompat implements CryptoCompat {
  constructor(private readonly native: NativeCryptoSnapshot) {}

  getRandomValues<T extends ArrayBufferView>(array: T): T {
    return Reflect.apply(this.native.getRandomValues, this.native.receiver, [array]) as T;
  }

  randomUUID(): string {
    return Reflect.apply(this.native.randomUUID, this.native.receiver, []) as string;
  }

  get subtle(): SubtleCrypto {
    return this.native.subtle;
  }
}

function getNativeCrypto(): NativeCryptoSnapshot {
  let cryptoImpl: unknown;
  try {
    cryptoImpl = Reflect.get(globalThis, "crypto");
  } catch {
    throw NOT_SUPPORTED.create({ message: "Web Crypto is not available in this runtime" });
  }

  if (typeof cryptoImpl !== "object" || cryptoImpl === null) {
    throw NOT_SUPPORTED.create({ message: "Web Crypto is not available in this runtime" });
  }

  let getRandomValues: unknown;
  let randomUUID: unknown;
  let subtle: unknown;
  try {
    getRandomValues = Reflect.get(cryptoImpl, "getRandomValues");
    randomUUID = Reflect.get(cryptoImpl, "randomUUID");
    subtle = Reflect.get(cryptoImpl, "subtle");
  } catch {
    throw NOT_SUPPORTED.create({ message: "Web Crypto is not available in this runtime" });
  }
  if (
    typeof getRandomValues !== "function" ||
    typeof randomUUID !== "function" ||
    typeof subtle !== "object" || subtle === null
  ) {
    throw NOT_SUPPORTED.create({ message: "Web Crypto is not available in this runtime" });
  }
  return Object.freeze({
    getRandomValues,
    randomUUID,
    receiver: cryptoImpl,
    subtle: subtle as SubtleCrypto,
  });
}

/**
 * Return a facade over the runtime's native Web Crypto implementation.
 *
 * Cryptographic operations, including constant-time signature verification,
 * stay owned by the native implementation. This module does not provide an
 * insecure software fallback.
 */
export function createCrypto(): CryptoCompat {
  return Object.freeze(new WebCryptoCompat(getNativeCrypto()));
}
