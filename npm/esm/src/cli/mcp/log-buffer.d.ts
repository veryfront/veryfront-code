export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogEntry {
    id: string;
    level: LogLevel;
    message: string;
    data?: Record<string, unknown>;
    timestamp: number;
    source: string;
}
export interface LogFilter {
    level?: LogLevel | LogLevel[];
    source?: string | string[];
    pattern?: string | RegExp;
    since?: number;
    limit?: number;
}
export type LogSubscriber = (entry: LogEntry) => void;
export declare class LogBuffer {
    private entries;
    private subscribers;
    private idCounter;
    private maxSize;
    constructor(options?: {
        maxSize?: number;
    });
    private generateId;
    append(entry: Omit<LogEntry, "id" | "timestamp">): LogEntry;
    debug(message: string, source?: string, data?: Record<string, unknown>): LogEntry;
    info(message: string, source?: string, data?: Record<string, unknown>): LogEntry;
    warn(message: string, source?: string, data?: Record<string, unknown>): LogEntry;
    error(message: string, source?: string, data?: Record<string, unknown>): LogEntry;
    query(filter?: LogFilter): LogEntry[];
    tail(count?: number): LogEntry[];
    getAll(): LogEntry[];
    clear(): void;
    get count(): number;
    countByLevel(): Record<LogLevel, number>;
    subscribe(callback: LogSubscriber): () => void;
    toJSON(): LogEntry[];
    format(entries?: LogEntry[]): string;
}
export declare function getLogBuffer(): LogBuffer;
export declare function resetLogBuffer(): void;
export declare function interceptConsole(buffer: LogBuffer, source?: string): () => void;
//# sourceMappingURL=log-buffer.d.ts.map