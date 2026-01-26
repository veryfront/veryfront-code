import { HASH_SEED_DJB2 } from "../../../utils/constants/hash.js";
export function computeEtag(text) {
    let h = HASH_SEED_DJB2;
    for (let i = 0; i < text.length; i++) {
        h = ((h << 5) + h) ^ text.charCodeAt(i);
    }
    return `W/"${(h >>> 0).toString(16)}"`;
}
