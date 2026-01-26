export type StepStatus = "pending" | "active" | "completed" | "error";
export interface Step {
    label: string;
    status: StepStatus;
    duration?: number;
}
export declare function formatStep(step: Step, spinnerFrame?: number): string;
export declare function renderSteps(steps: Step[], spinnerFrame?: number): string;
export declare function formatDuration(ms: number): string;
export declare function progressBar(current: number, total: number, options?: {
    width?: number;
    label?: string;
    showPercent?: boolean;
}): string;
export declare function xOfY(current: number, total: number, label?: string): string;
export interface SpinnerController {
    update: (text: string) => void;
    success: (text?: string) => void;
    error: (text?: string) => void;
    stop: () => void;
}
export declare function createSpinner(text: string): SpinnerController;
export declare function inlineSpinner(text: string, frame?: number): string;
export declare class TaskList {
    private tasks;
    private frame;
    private interval;
    add(label: string): number;
    start(index: number): void;
    complete(index: number): void;
    fail(index: number): void;
    render(): string;
    startAnimation(onFrame: (output: string) => void): void;
    stopAnimation(): void;
}
//# sourceMappingURL=progress.d.ts.map