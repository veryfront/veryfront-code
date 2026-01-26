import * as dntShim from "../../../_dnt.shims.js";
import { rendererLogger as logger } from "../../utils/index.js";
import ReactDOM from "react-dom/client";
import { extractPageDataFromScript, NavigationHandlers, PageLoader, PageTransition, ViewportPrefetch, } from "../../routing/index.js";
export class VeryfrontRouter {
    baseUrl;
    currentPath;
    root = null;
    options;
    spaMode;
    spaNavigationHandler = null;
    pageLoader;
    navigationHandlers;
    pageTransition;
    viewportPrefetch;
    handleClick;
    handlePopState;
    handleMouseOver;
    constructor(options = {}) {
        const globalOptions = this.loadGlobalOptions();
        this.options = { ...globalOptions, ...options };
        this.baseUrl = this.options.baseUrl || globalThis.location.origin;
        this.currentPath = globalThis.location.pathname;
        this.spaMode = this.options.spaMode ?? globalThis.__VERYFRONT_SPA_MODE__ ?? false;
        this.pageLoader = new PageLoader();
        this.navigationHandlers = new NavigationHandlers(this.options.prefetchDelay, this.options.prefetch);
        this.pageTransition = new PageTransition((root) => this.viewportPrefetch.setup(root));
        this.viewportPrefetch = new ViewportPrefetch((path) => this.prefetch(path), this.options.prefetch);
        this.handleClick = this.navigationHandlers.createClickHandler({
            onNavigate: (url) => this.navigate(url),
            onPrefetch: (url) => this.prefetch(url),
        });
        this.handlePopState = this.navigationHandlers.createPopStateHandler({
            onNavigate: (url) => this.navigate(url, false),
            onPrefetch: (url) => this.prefetch(url),
        });
        this.handleMouseOver = this.navigationHandlers.createMouseOverHandler({
            onNavigate: (url) => this.navigate(url),
            onPrefetch: (url) => this.prefetch(url),
        });
    }
    registerNavigationHandler(handler) {
        logger.debug("[Veryfront] Registering SPA navigation handler");
        this.spaNavigationHandler = handler;
        this.spaMode = true;
    }
    loadGlobalOptions() {
        try {
            const options = globalThis.__VERYFRONT_ROUTER_OPTS__;
            if (!options) {
                logger.debug("[Veryfront] No global options configured");
                return {};
            }
            return options;
        }
        catch (error) {
            logger.error("[Veryfront] Failed to read global options:", error);
            return {};
        }
    }
    init() {
        logger.debug("Initializing client-side router");
        const rootElement = document.getElementById("root");
        if (!rootElement) {
            logger.error("Root element not found");
            return;
        }
        const ReactDOMToUse = dntShim.dntGlobalThis.ReactDOM || ReactDOM;
        this.root = ReactDOMToUse.createRoot(rootElement);
        document.addEventListener("click", this.handleClick);
        globalThis.addEventListener("popstate", this.handlePopState);
        document.addEventListener("mouseover", this.handleMouseOver);
        this.viewportPrefetch.setup(document);
        this.cacheCurrentPage();
    }
    cacheCurrentPage() {
        const pageData = extractPageDataFromScript();
        if (pageData)
            this.pageLoader.setCache(this.currentPath, pageData);
    }
    async navigate(url, pushState = true) {
        logger.debug(`Navigating to ${url} (SPA mode: ${this.spaMode})`);
        this.navigationHandlers.saveScrollPosition(this.currentPath);
        this.options.onStart?.(url);
        if (pushState)
            globalThis.history.pushState({}, "", url);
        if (this.spaMode && this.spaNavigationHandler) {
            await this.loadSpaPage(url);
        }
        else {
            await this.loadPage(url);
        }
        this.options.onNavigate?.(url);
    }
    async loadSpaPage(path) {
        logger.debug(`[Veryfront] Loading SPA page: ${path}`);
        try {
            const spaData = await this.pageLoader.loadSpaPageData(path);
            await this.spaNavigationHandler?.(spaData);
            this.currentPath = path;
            this.handleScrollAfterNavigation();
            this.options.onComplete?.(path);
        }
        catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            logger.error(`[Veryfront] Failed to load SPA page ${path}`, normalizedError);
            this.options.onError?.(normalizedError);
            this.pageTransition.showError(normalizedError);
        }
    }
    handleScrollAfterNavigation() {
        const isPopState = this.navigationHandlers.isPopState();
        const scrollY = this.navigationHandlers.getScrollPosition(this.currentPath);
        try {
            globalThis.scrollTo(0, isPopState ? scrollY : 0);
        }
        catch (error) {
            logger.warn("[Veryfront] scroll handling failed", error);
        }
        this.navigationHandlers.clearPopStateFlag();
    }
    async loadPage(path, updateUI = true) {
        if (this.pageLoader.isCached(path)) {
            logger.debug(`Loading ${path} from cache`);
            const data = this.pageLoader.getCached(path);
            if (data) {
                if (updateUI)
                    this.updatePage(data);
                return;
            }
            logger.warn(`[Veryfront] Cache entry for ${path} was unexpectedly null, fetching fresh data`);
        }
        this.pageTransition.setLoadingState(true);
        try {
            const data = await this.pageLoader.loadPage(path);
            if (updateUI)
                this.updatePage(data);
            this.currentPath = path;
            this.options.onComplete?.(path);
        }
        catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            logger.error(`Failed to load ${path}`, normalizedError);
            this.options.onError?.(normalizedError);
            this.pageTransition.showError(normalizedError);
        }
        finally {
            this.pageTransition.setLoadingState(false);
        }
    }
    async prefetch(path) {
        if (this.spaMode) {
            await this.pageLoader.prefetchSpaPageData(path);
            return;
        }
        await this.pageLoader.prefetch(path);
    }
    updatePage(data) {
        if (!this.root)
            return;
        const isPopState = this.navigationHandlers.isPopState();
        const scrollY = this.navigationHandlers.getScrollPosition(this.currentPath);
        this.pageTransition.updatePage(data, isPopState, scrollY);
        this.navigationHandlers.clearPopStateFlag();
    }
    destroy() {
        document.removeEventListener("click", this.handleClick);
        globalThis.removeEventListener("popstate", this.handlePopState);
        document.removeEventListener("mouseover", this.handleMouseOver);
        this.viewportPrefetch.disconnect();
        this.pageLoader.clearCache();
        this.navigationHandlers.clear();
        this.pageTransition.destroy();
    }
}
if (typeof dntShim.dntGlobalThis !== "undefined" && globalThis.document) {
    const router = new VeryfrontRouter();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => router.init());
    }
    else {
        router.init();
    }
    dntShim.dntGlobalThis.veryFrontRouter = router;
}
