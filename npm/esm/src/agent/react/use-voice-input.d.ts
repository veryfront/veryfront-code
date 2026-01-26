export interface UseVoiceInputOptions {
    /** Language for speech recognition (default: browser default) */
    language?: string;
    /** Continuous listening mode (default: false) */
    continuous?: boolean;
    /** Show interim results while speaking (default: true) */
    interimResults?: boolean;
    /** Callback when transcript is received */
    onTranscript?: (transcript: string, isFinal: boolean) => void;
    /** Callback when an error occurs */
    onError?: (error: string) => void;
    /** Callback when listening starts */
    onStart?: () => void;
    /** Callback when listening ends */
    onEnd?: () => void;
}
export interface UseVoiceInputResult {
    /** Whether voice input is supported in this browser */
    isSupported: boolean;
    /** Whether currently listening */
    isListening: boolean;
    /** Current transcript (interim or final) */
    transcript: string;
    /** Start listening */
    start: () => void;
    /** Stop listening */
    stop: () => void;
    /** Toggle listening on/off */
    toggle: () => void;
    /** Clear the transcript */
    clear: () => void;
    /** Last error message */
    error: string | null;
}
export declare function useVoiceInput(options?: UseVoiceInputOptions): UseVoiceInputResult;
//# sourceMappingURL=use-voice-input.d.ts.map