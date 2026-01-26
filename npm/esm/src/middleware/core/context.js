import * as dntShim from "../../../_dnt.shims.js";
import { HTTP_REDIRECT_FOUND } from "../../utils/index.js";
export class MiddlewareContext {
    req;
    request;
    env;
    executionCtx;
    var = {};
    store = new Map();
    constructor(req, env = {}, executionCtx) {
        this.req = req;
        this.request = req; // Alias for compatibility
        this.env = env;
        this.executionCtx = executionCtx;
    }
    json(object, init) {
        return dntShim.Response.json(object, init);
    }
    text(text, init) {
        return new dntShim.Response(text, {
            ...init,
            headers: {
                "content-type": "text/plain; charset=utf-8",
                ...(init?.headers ?? {}),
            },
        });
    }
    html(html, init) {
        return new dntShim.Response(html, {
            ...init,
            headers: {
                "content-type": "text/html; charset=utf-8",
                ...(init?.headers ?? {}),
            },
        });
    }
    redirect(location, status = HTTP_REDIRECT_FOUND) {
        return new dntShim.Response(null, {
            status,
            headers: { Location: location },
        });
    }
    set(key, value) {
        this.store.set(key, value);
    }
    get(key) {
        return this.store.get(key);
    }
}
