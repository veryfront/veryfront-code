import * as dntShim from "../../../_dnt.shims.js";
export interface CryptoCompat {
    getRandomValues(array: Uint8Array): Uint8Array;
    randomUUID(): string;
    subtle: dntShim.SubtleCrypto;
}
export declare function createCrypto(): CryptoCompat;
//# sourceMappingURL=crypto.d.ts.map