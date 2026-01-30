/**
 * URL import handling strategy.
 *
 * Priority: 7
 * Handles: esm.sh URLs that need deps added
 */
import { addEsmShDeps, isEsmShUrl } from "../url-builder.js";
export class UrlStrategy {
    name = "url";
    priority = 7;
    matches(specifier, _ctx) {
        return isEsmShUrl(specifier);
    }
    rewrite(info, ctx) {
        // Add deps to esm.sh URLs that don't have them
        const withDeps = addEsmShDeps(info.specifier, ctx.reactVersion);
        if (withDeps !== info.specifier) {
            return { specifier: withDeps };
        }
        return { specifier: null };
    }
}
export const urlStrategy = new UrlStrategy();
