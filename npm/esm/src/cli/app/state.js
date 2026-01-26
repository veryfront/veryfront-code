import { createListState } from "./components/list-select.js";
import { getRuntimeEnv } from "../../config/runtime-env.js";
import { cwd } from "../../platform/compat/process.js";
export function createInitialState() {
    return {
        view: "dashboard",
        previousView: null,
        server: {
            running: false,
            url: "http://veryfront.me:8080",
            port: 8080,
            errors: 0,
            warnings: 0,
        },
        mcp: {
            enabled: false,
            transport: null,
            connected: false,
        },
        remote: {
            user: null,
            projects: [],
            focusedIndex: 0,
            scrollOffset: 0,
        },
        projects: createListState([]),
        examples: createListState([]),
        templates: createListState([]),
        activeList: "projects",
        selectedProject: null,
        wizard: {
            step: 0,
            startType: null,
            selectedTemplate: null,
            integrations: [],
            projectName: "",
        },
        input: {
            active: false,
            prompt: "",
            value: "",
            cursorPos: 0,
            onSubmit: null,
            onCancel: null,
        },
        logs: [],
        maxLogs: 100,
        logsExpanded: false,
        logScroll: 0,
        authProviderIndex: 0,
        newProjectIndex: 0,
    };
}
export function setProjects(projects) {
    return (state) => ({
        ...state,
        projects: createListState(projects.map((p) => ({
            id: p.slug,
            label: p.slug,
            meta: shortenPath(p.path),
            data: { slug: p.slug, path: p.path, type: "local" },
        }))),
    });
}
export function setExamples(examples) {
    return (state) => ({
        ...state,
        examples: createListState(examples.map((e) => ({
            id: e.slug,
            label: e.slug,
            description: e.description,
            data: { slug: e.slug, path: e.path, type: "example" },
        }))),
    });
}
export function setTemplates(templates) {
    return (state) => ({
        ...state,
        templates: createListState(templates.map((t) => ({
            id: t.id,
            label: t.name,
            description: t.description,
            data: { slug: t.id, path: "", type: "template" },
        }))),
    });
}
export function updateServer(update) {
    return (state) => ({ ...state, server: { ...state.server, ...update } });
}
export function updateMCP(update) {
    return (state) => ({ ...state, mcp: { ...state.mcp, ...update } });
}
export function updateRemote(update) {
    return (state) => ({ ...state, remote: { ...state.remote, ...update } });
}
export function navigateTo(view) {
    return (state) => ({ ...state, view, previousView: state.view });
}
export function goBack() {
    return (state) => ({
        ...state,
        view: state.previousView ?? "dashboard",
        previousView: null,
    });
}
export function setActiveList(list) {
    return (state) => ({ ...state, activeList: list });
}
export function updateActiveList(updater) {
    return (state) => {
        const key = state.activeList;
        // remoteProjects is not a ListSelectState, skip update
        if (key === "remoteProjects")
            return state;
        return { ...state, [key]: updater(state[key]) };
    };
}
export function selectProject(project) {
    return (state) => {
        if (!project)
            return { ...state, selectedProject: null };
        return {
            ...state,
            selectedProject: project,
            view: "project-detail",
            previousView: state.view,
        };
    };
}
export function updateWizard(update) {
    return (state) => ({ ...state, wizard: { ...state.wizard, ...update } });
}
export function resetWizard() {
    return (state) => ({
        ...state,
        wizard: {
            step: 0,
            startType: null,
            selectedTemplate: null,
            integrations: [],
            projectName: "",
        },
    });
}
export function startInput(prompt, onSubmit, onCancel, initialValue) {
    return (state) => ({
        ...state,
        input: {
            active: true,
            prompt,
            value: initialValue ?? "",
            cursorPos: initialValue?.length ?? 0,
            onSubmit,
            onCancel: onCancel ?? null,
        },
    });
}
export function updateInputValue(value, cursorPos) {
    return (state) => ({
        ...state,
        input: { ...state.input, value, cursorPos },
    });
}
export function endInput() {
    return (state) => ({
        ...state,
        input: {
            active: false,
            prompt: "",
            value: "",
            cursorPos: 0,
            onSubmit: null,
            onCancel: null,
        },
    });
}
export function addLog(level, message, meta) {
    return (state) => {
        const logs = [...state.logs, { time: new Date(), level, message, meta }];
        if (logs.length > state.maxLogs)
            logs.shift();
        return { ...state, logs };
    };
}
export function clearLogs() {
    return (state) => ({ ...state, logs: [], logScroll: 0 });
}
export function toggleLogsExpanded() {
    return (state) => ({
        ...state,
        logsExpanded: !state.logsExpanded,
        logScroll: 0,
    });
}
export function scrollLogs(direction) {
    return (state) => {
        if (!state.logsExpanded)
            return state;
        const maxScroll = Math.max(0, state.logs.length - 5);
        let newScroll = state.logScroll;
        if (direction === "up") {
            newScroll = Math.min(maxScroll, state.logScroll + 1);
        }
        else {
            newScroll = Math.max(0, state.logScroll - 1);
        }
        return { ...state, logScroll: newScroll };
    };
}
function shortenPath(path, env = getRuntimeEnv()) {
    // Prefer relative path to cwd
    const currentDir = cwd();
    if (path.startsWith(currentDir + "/")) {
        return "./" + path.slice(currentDir.length + 1);
    }
    if (path === currentDir) {
        return "./";
    }
    // Fall back to ~ for home
    const home = env.homeDir ?? "";
    if (home && path.startsWith(home)) {
        return `~${path.slice(home.length)}`;
    }
    return path;
}
export function getActiveSelection(state) {
    // remoteProjects is not a ListSelectState
    if (state.activeList === "remoteProjects")
        return undefined;
    const list = state[state.activeList];
    return list.items[list.selectedIndex];
}
