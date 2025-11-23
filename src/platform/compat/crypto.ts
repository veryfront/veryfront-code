import { isDeno } from "./runtime.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

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

type NodeCryptoModule = Crypto;

class NodeCrypto implements CryptoCompat {
  private crypto: NodeCryptoModule | null = null;

  constructor() {
    this.initNodeModules();
  }

  private async initNodeModules() {
    try {
      const nodeCrypto = await import("node:crypto") as { webcrypto?: Crypto };

      this.crypto = nodeCrypto.webcrypto || (globalThis.crypto as Crypto);
    } catch (_error) {
      throw toError(createError({
        type: "not_supported",
        message: "Node.js crypto module not available",
        feature: "Node.js",
      }));
    }
  }

  getRandomValues(array: Uint8Array): Uint8Array {
    if (!this.crypto) {
      throw toError(createError({
        type: "config",
        message: "Crypto not initialized",
      }));
    }
    return this.crypto.getRandomValues(array);
  }

  randomUUID(): string {
    if (!this.crypto) {
      throw toError(createError({
        type: "config",
        message: "Crypto not initialized",
      }));
    }
    return this.crypto.randomUUID();
  }

  get subtle(): SubtleCrypto {
    if (!this.crypto) {
      throw toError(createError({
        type: "config",
        message: "Crypto not initialized",
      }));
    }
    return this.crypto.subtle;
  }
}

export function createCrypto() {
  if (isDeno) {
    return new DenoCrypto();
  } else {
    return new NodeCrypto();
  }
}
