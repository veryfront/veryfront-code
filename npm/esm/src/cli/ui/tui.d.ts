export interface TuiConfig {
    title?: string;
    subtitle?: string;
    showLogs?: boolean;
}
export interface TuiState {
    status: string;
    statusType: "loading" | "success" | "error" | "info";
    steps: {
        label: string;
        done: boolean;
    }[];
    currentStep: number;
    info: Record<string, string>;
    logs: string[];
    logsExpanded: boolean;
    logScroll: number;
}
export declare function createTui(cfg?: TuiConfig): {
    setInfo: (info: Record<string, string>) => void;
    setSteps: (steps: string[]) => void;
    completeStep: () => void;
    setStatus: (status: string, type?: TuiState["statusType"]) => void;
    addLog: (msg: string) => void;
    toggleLogs: () => void;
    scrollLogs: (dir: "up" | "down") => void;
    cleanup: () => void;
    render: () => void;
};
export type Tui = ReturnType<typeof createTui>;
export declare function interceptConsole(tui: Tui): () => void;
export declare function handleInput(tui: Tui, opts: {
    onEnter?: () => void;
    onExit?: () => void;
}): Promise<void>;
//# sourceMappingURL=tui.d.ts.map