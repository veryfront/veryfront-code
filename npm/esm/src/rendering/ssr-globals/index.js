/**
 * SSR Browser Globals
 *
 * Provides minimal browser API stubs for SSR to prevent crashes when
 * third-party libraries check for browser features during server rendering.
 *
 * @module rendering/ssr-globals
 */
import * as dntShim from "../../../_dnt.shims.js";
export { disableSSRClientOnlyFetching, enableSSRClientOnlyFetching, isSSRGlobalsActive, setSSRProjectDomain, setSSRServerPort, } from "./context.js";
export { disableSSRFetchInterception, enableSSRFetchInterception } from "./fetch-interceptor.js";
export { createDocumentStub, createElementClass, createElementStub, createWindowStub, } from "./dom-stubs.js";
import { isSSRGlobalsActive, markSSRGlobalsInitialized } from "./context.js";
import { createElementClass, createWindowStub } from "./dom-stubs.js";
function setGlobal(name, value) {
    try {
        dntShim.dntGlobalThis[name] = value;
    }
    catch {
        Object.defineProperty(dntShim.dntGlobalThis, name, {
            value,
            writable: true,
            configurable: true,
        });
    }
}
function setGlobalIfMissing(name, value) {
    if (typeof dntShim.dntGlobalThis[name] !== "undefined")
        return;
    setGlobal(name, value);
}
export function setupSSRGlobals() {
    if (isSSRGlobalsActive())
        return;
    if (typeof globalThis.window !== "undefined" && typeof globalThis.document !== "undefined") {
        return;
    }
    const windowStub = createWindowStub();
    setGlobal("window", windowStub);
    setGlobal("document", windowStub.document);
    setGlobal("navigator", windowStub.navigator);
    setGlobal("location", windowStub.location);
    setGlobal("history", windowStub.history);
    setGlobal("localStorage", windowStub.localStorage);
    setGlobal("sessionStorage", windowStub.sessionStorage);
    setGlobal("matchMedia", windowStub.matchMedia);
    setGlobal("getComputedStyle", windowStub.getComputedStyle);
    setGlobal("requestAnimationFrame", windowStub.requestAnimationFrame);
    setGlobal("cancelAnimationFrame", windowStub.cancelAnimationFrame);
    setGlobal("self", windowStub);
    setGlobal("__VERYFRONT_SSR__", true);
    setGlobalIfMissing("Element", createElementClass("Element"));
    setGlobalIfMissing("HTMLElement", createElementClass("HTMLElement"));
    setGlobalIfMissing("SVGElement", createElementClass("SVGElement"));
    setGlobalIfMissing("Node", createElementClass("Node"));
    setGlobalIfMissing("Text", createElementClass("Text"));
    setGlobalIfMissing("Comment", createElementClass("Comment"));
    setGlobalIfMissing("DocumentFragment", createElementClass("DocumentFragment"));
    markSSRGlobalsInitialized();
}
