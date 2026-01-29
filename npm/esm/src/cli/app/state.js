// TUI Application State
// Simple, focused state management for Veryfront Code
import { createListState } from "./components/list-select.js";
import { getRuntimeEnv } from "../../config/runtime-env.js";
import { cwd } from "../../platform/compat/process.js";
import { createCodingAgentState, createCommandPaletteState, createKeyChordState, } from "./core/types.js";
// ============================================================================
// Initial State
// ============================================================================
export function createInitialState() {
    return {
        view: "dashboard",
        previousView: null,
        mode: "NORMAL",
        keyChord: createKeyChordState(),
        commandPalette: createCommandPaletteState(),
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
        activeSection: "projects",
        projects: createListState([]),
        templates: createListState([]),
        examples: createListState([]),
        remote: {
            user: null,
            projects: [],
            focusedIndex: 0,
            scrollOffset: 0,
        },
        code: {
            agent: null,
            model: null,
            projectPath: null,
            running: false,
        },
        agents: createCodingAgentState(),
        resourceTab: "files",
        activeProject: null,
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
        codeMenuIndex: 0,
        showHelp: false,
    };
}
// Navigation
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
// Server
export function updateServer(update) {
    return (state) => ({ ...state, server: { ...state.server, ...update } });
}
export function updateMCP(update) {
    return (state) => ({ ...state, mcp: { ...state.mcp, ...update } });
}
// Dashboard
export function setActiveSection(section) {
    return (state) => ({ ...state, activeSection: section });
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
export function updateRemote(update) {
    return (state) => ({ ...state, remote: { ...state.remote, ...update } });
}
export function updateActiveList(updater) {
    return (state) => {
        const section = state.activeSection;
        if (section === "remote")
            return state;
        return { ...state, [section]: updater(state[section]) };
    };
}
// Code view
export function enterCodeView(projectPath) {
    return (state) => ({
        ...state,
        view: "code",
        previousView: state.view,
        code: { ...state.code, projectPath },
    });
}
export function setCodeAgent(agent, model) {
    return (state) => ({
        ...state,
        code: { ...state.code, agent, model: model ?? agent?.defaultModel ?? null },
    });
}
export function setCodeRunning(running) {
    return (state) => ({ ...state, code: { ...state.code, running } });
}
// Agent picker
export function openAgentPicker() {
    return (state) => ({
        ...state,
        agents: { ...state.agents, pickerOpen: true, pickerIndex: 0 },
    });
}
export function closeAgentPicker() {
    return (state) => ({
        ...state,
        agents: { ...state.agents, pickerOpen: false },
    });
}
export function moveAgentPicker(delta) {
    return (state) => {
        const maxIndex = state.agents.agents.length - 1;
        let newIndex = state.agents.pickerIndex + delta;
        if (newIndex < 0)
            newIndex = maxIndex;
        if (newIndex > maxIndex)
            newIndex = 0;
        return { ...state, agents: { ...state.agents, pickerIndex: newIndex } };
    };
}
export function selectAgent(agent) {
    return (state) => ({
        ...state,
        agents: {
            ...state.agents,
            activeAgent: agent,
            activeModel: agent?.defaultModel ?? null,
            pickerOpen: false,
        },
        code: {
            ...state.code,
            agent,
            model: agent?.defaultModel ?? null,
        },
    });
}
export function setModel(model) {
    return (state) => ({
        ...state,
        agents: { ...state.agents, activeModel: model },
        code: { ...state.code, model },
    });
}
export function setAgents(agents, installed) {
    return (state) => ({
        ...state,
        agents: { ...state.agents, agents, installedAgents: installed },
    });
}
// Resources view
export function setResourceTab(tab) {
    return (state) => ({ ...state, resourceTab: tab });
}
export function setActiveProject(project) {
    return (state) => ({ ...state, activeProject: project });
}
// Input
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
// Logs
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
    return (state) => ({ ...state, logsExpanded: !state.logsExpanded, logScroll: 0 });
}
export function scrollLogs(direction) {
    return (state) => {
        if (!state.logsExpanded)
            return state;
        const maxScroll = Math.max(0, state.logs.length - 5);
        const delta = direction === "up" ? 1 : -1;
        const newScroll = Math.max(0, Math.min(maxScroll, state.logScroll + delta));
        return { ...state, logScroll: newScroll };
    };
}
// Mode
export function setMode(mode) {
    return (state) => ({ ...state, mode });
}
export function setKeyChord(keyChord) {
    return (state) => ({ ...state, keyChord });
}
export function resetKeyChord() {
    return (state) => ({ ...state, keyChord: createKeyChordState() });
}
export function setCommandPaletteOpen(open) {
    return (state) => ({
        ...state,
        commandPalette: { ...state.commandPalette, open, query: "", selectedIndex: 0 },
        mode: open ? "COMMAND" : "NORMAL",
    });
}
export function updateCommandPalette(update) {
    return (state) => ({
        ...state,
        commandPalette: { ...state.commandPalette, ...update },
    });
}
// UI
export function toggleHelp() {
    return (state) => ({ ...state, showHelp: !state.showHelp });
}
// ============================================================================
// Helpers
// ============================================================================
function shortenPath(path, env = getRuntimeEnv()) {
    const currentDir = cwd();
    if (path.startsWith(currentDir + "/"))
        return "./" + path.slice(currentDir.length + 1);
    if (path === currentDir)
        return "./";
    const home = env.homeDir ?? "";
    if (home && path.startsWith(home))
        return `~${path.slice(home.length)}`;
    return path;
}
export function getActiveSelection(state) {
    if (state.activeSection === "remote")
        return undefined;
    const list = state[state.activeSection];
    return list.items[list.selectedIndex];
}
