import { isDeno } from "./runtime.ts";

interface CryptoCompat {
  getRandomValues<T extends Uint8Array<ArrayBufferLike>>(array: T): T;
  randomUUID(): string;
  subtle: SubtleCrypto;
}

class WebCryptoCompat implements CryptoCompat {
  constructor(private readonly cryptoImpl: Crypto) {}

  getRandomValues<T extends Uint8Array<ArrayBufferLike>>(array: T): T {
    return this.cryptoImpl.getRandomValues(array);
  }

  randomUUID(): string {
    return this.cryptoImpl.randomUUID();
  }

  get subtle(): SubtleCrypto {
    return this.cryptoImpl.subtle;
  }
}

export function createCrypto(): CryptoCompat {
  const cryptoImpl = isDeno ? crypto : globalThis.crypto;
  return new WebCryptoCompat(cryptoImpl);
}
