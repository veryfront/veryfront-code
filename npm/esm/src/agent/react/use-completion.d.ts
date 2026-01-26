/**
 * useCompletion Hook - Layer 1 (Headless)
 *
 * Single text completion with streaming support.
 */
import * as dntShim from "../../../_dnt.shims.js";
export interface UseCompletionOptions {
    /** API endpoint for completion */
    api: string;
    /** Additional data to send */
    body?: Record<string, unknown>;
    /** Custom headers */
    headers?: Record<string, string>;
    /** Callback when response received */
    onResponse?: (response: dntShim.Response) => void;
    /** Callback when completion finished */
    onFinish?: (completion: string) => void;
    /** Callback when error occurs */
    onError?: (error: Error) => void;
}
export interface UseCompletionResult {
    /** Generated completion text */
    completion: string;
    /** Loading state */
    isLoading: boolean;
    /** Error state */
    error: Error | null;
    /** Complete a prompt */
    complete: (prompt: string) => Promise<void>;
    /** Stop generation */
    stop: () => void;
    /** Set completion manually */
    setCompletion: (completion: string) => void;
}
/**
 * useCompletion hook for single text generation
 */
export declare function useCompletion(options: UseCompletionOptions): UseCompletionResult;
//# sourceMappingURL=use-completion.d.ts.map