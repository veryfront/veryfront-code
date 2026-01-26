export interface UseStreamingOptions {
    /** URL to stream from */
    url: string;
    /** Callback for each chunk */
    onChunk?: (chunk: string) => void;
    /** Callback when stream completes */
    onComplete?: () => void;
    /** Callback when error occurs */
    onError?: (error: Error) => void;
}
export interface UseStreamingResult {
    /** Streaming data */
    data: string;
    /** Streaming state */
    isStreaming: boolean;
    /** Error state */
    error: Error | null;
    /** Start streaming */
    start: (body?: Record<string, unknown>) => Promise<void>;
    /** Stop streaming */
    stop: () => void;
    /** Reset data */
    reset: () => void;
}
export declare function useStreaming(options: UseStreamingOptions): UseStreamingResult;
//# sourceMappingURL=use-streaming.d.ts.map