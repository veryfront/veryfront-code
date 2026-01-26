import * as dntShim from "../../../_dnt.shims.js";
import { isDeno } from "./runtime.js";
class WebCryptoCompat {
    cryptoImpl;
    constructor(cryptoImpl) {
        this.cryptoImpl = cryptoImpl;
    }
    getRandomValues(array) {
        return this.cryptoImpl.getRandomValues(array);
    }
    randomUUID() {
        return this.cryptoImpl.randomUUID();
    }
    get subtle() {
        return this.cryptoImpl.subtle;
    }
}
export function createCrypto() {
    const cryptoImpl = isDeno ? dntShim.crypto : dntShim.dntGlobalThis.crypto;
    return new WebCryptoCompat(cryptoImpl);
}
