import * as dntShim from "../../_dnt.shims.js";
import { serverLogger as logger } from "../utils/index.js";
const DEBOUNCE_MS = 300;
class ReloadNotifierImpl {
    listeners = new Set();
    invalidateListeners = new Set();
    debounceTimer = null;
    pendingChangedPaths = new Set();
    pendingProject;
    metrics = {
        triggerCalls: 0,
        broadcastsSent: 0,
        lastTriggerTime: 0,
    };
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    subscribeInvalidate(listener) {
        this.invalidateListeners.add(listener);
        return () => this.invalidateListeners.delete(listener);
    }
    triggerReload(changedPaths, project) {
        this.metrics.triggerCalls++;
        this.metrics.lastTriggerTime = Date.now();
        const projectInfo = normalizeProjectInfo(project);
        logger.debug("[ReloadNotifier] triggerReload called", {
            invalidateListeners: this.invalidateListeners.size,
            reloadListeners: this.listeners.size,
            changedPaths,
            project: projectInfo,
        });
        if (changedPaths?.length) {
            for (const path of changedPaths)
                this.pendingChangedPaths.add(path);
        }
        if (projectInfo)
            this.pendingProject = projectInfo;
        this.notifyInvalidateListeners();
        if (this.debounceTimer)
            clearTimeout(this.debounceTimer);
        this.debounceTimer = dntShim.setTimeout(() => {
            this.debounceTimer = null;
            const paths = this.pendingChangedPaths.size > 0
                ? Array.from(this.pendingChangedPaths)
                : undefined;
            const projectInfo = this.pendingProject;
            this.pendingChangedPaths.clear();
            this.pendingProject = undefined;
            logger.debug("[ReloadNotifier] Debounce complete, notifying reload listeners", {
                listenerCount: this.listeners.size,
                changedPaths: paths,
                project: projectInfo,
            });
            this.notifyListeners(paths, projectInfo);
        }, DEBOUNCE_MS);
    }
    notifyInvalidateListeners() {
        logger.debug("[ReloadNotifier] Notifying invalidate listeners", {
            count: this.invalidateListeners.size,
        });
        for (const listener of this.invalidateListeners) {
            try {
                listener();
            }
            catch (error) {
                logger.error("[ReloadNotifier] Invalidate listener error:", error);
            }
        }
    }
    notifyListeners(changedPaths, project) {
        this.metrics.broadcastsSent++;
        logger.debug("[ReloadNotifier] Notifying reload listeners", {
            count: this.listeners.size,
            changedPaths,
            project,
        });
        for (const listener of this.listeners) {
            try {
                listener(changedPaths, project);
            }
            catch (error) {
                logger.error("[ReloadNotifier] Listener error:", error);
            }
        }
    }
    getListenerCount() {
        return this.listeners.size;
    }
    getInvalidateListenerCount() {
        return this.invalidateListeners.size;
    }
    getMetrics() {
        return {
            ...this.metrics,
            activeReloadListeners: this.listeners.size,
            activeInvalidateListeners: this.invalidateListeners.size,
        };
    }
    reset() {
        this.listeners.clear();
        this.invalidateListeners.clear();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.pendingChangedPaths.clear();
        this.pendingProject = undefined;
        this.metrics = {
            triggerCalls: 0,
            broadcastsSent: 0,
            lastTriggerTime: 0,
        };
    }
}
export const ReloadNotifier = new ReloadNotifierImpl();
function normalizeProjectInfo(project) {
    if (!project)
        return undefined;
    if (typeof project === "string")
        return { projectSlug: project };
    return project;
}
