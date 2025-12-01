import { isDeno } from "./runtime.ts";

export interface CryptoCompat {
  getRandomValues(array: Uint8Array): Uint8Array;
  randomUUID(): string;
  subtle: SubtleCrypto;
}

class DenoCrypto implements CryptoCompat {
  getRandomValues(array: Uint8Array): Uint8Array {
    return crypto.getRandomValues(array);
  }

  randomUUID(): string {
    return crypto.randomUUID();
  }

  get subtle(): SubtleCrypto {
    return crypto.subtle;
  }
}

class NodeCrypto implements CryptoCompat {
  getRandomValues(array: Uint8Array): Uint8Array {
    return globalThis.crypto.getRandomValues(array);
  }

  randomUUID(): string {
    return globalThis.crypto.randomUUID();
  }

  get subtle(): SubtleCrypto {
    return globalThis.crypto.subtle;
  }
}

export function createCrypto() {
  if (isDeno) {
    return new DenoCrypto();
  } else {
    return new NodeCrypto();
  }
}
