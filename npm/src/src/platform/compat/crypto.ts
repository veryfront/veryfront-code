import * as dntShim from "../../../_dnt.shims.js";
import { isDeno } from "./runtime.js";

export interface CryptoCompat {
  getRandomValues(array: Uint8Array): Uint8Array;
  randomUUID(): string;
  subtle: dntShim.SubtleCrypto;
}

class WebCryptoCompat implements CryptoCompat {
  constructor(private readonly cryptoImpl: dntShim.Crypto) {}

  getRandomValues(array: Uint8Array): Uint8Array {
    return this.cryptoImpl.getRandomValues(array);
  }

  randomUUID(): string {
    return this.cryptoImpl.randomUUID();
  }

  get subtle(): dntShim.SubtleCrypto {
    return this.cryptoImpl.subtle;
  }
}

export function createCrypto(): CryptoCompat {
  const cryptoImpl = isDeno ? dntShim.crypto : dntShim.dntGlobalThis.crypto;
  return new WebCryptoCompat(cryptoImpl);
}
