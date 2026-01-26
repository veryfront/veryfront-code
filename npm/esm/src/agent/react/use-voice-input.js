import * as dntShim from "../../../_dnt.shims.js";
import * as React from "react";
export function useVoiceInput(options = {}) {
    const { language, continuous = false, interimResults = true, onTranscript, onError, onStart, onEnd, } = options;
    const [isListening, setIsListening] = React.useState(false);
    const [transcript, setTranscript] = React.useState("");
    const [error, setError] = React.useState(null);
    const recognitionRef = React.useRef(null);
    const isSupported = React.useMemo(() => {
        if (typeof dntShim.dntGlobalThis === "undefined")
            return false;
        const g = dntShim.dntGlobalThis;
        return !!(g.SpeechRecognition || g.webkitSpeechRecognition);
    }, []);
    React.useEffect(() => {
        if (!isSupported)
            return;
        const g = dntShim.dntGlobalThis;
        const SpeechRecognitionAPI = g.SpeechRecognition ?? g.webkitSpeechRecognition;
        if (!SpeechRecognitionAPI)
            return;
        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = continuous;
        recognition.interimResults = interimResults;
        if (language)
            recognition.lang = language;
        recognition.onresult = (event) => {
            let finalTranscript = "";
            let interimTranscript = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const alt = result?.[0];
                if (!alt)
                    continue;
                if (result.isFinal) {
                    finalTranscript += alt.transcript;
                }
                else {
                    interimTranscript += alt.transcript;
                }
            }
            const currentTranscript = finalTranscript || interimTranscript;
            setTranscript(currentTranscript);
            onTranscript?.(currentTranscript, !!finalTranscript);
        };
        recognition.onerror = (event) => {
            const errorMessage = getErrorMessage(event.error);
            setError(errorMessage);
            setIsListening(false);
            onError?.(errorMessage);
        };
        recognition.onstart = () => {
            setIsListening(true);
            setError(null);
            onStart?.();
        };
        recognition.onend = () => {
            setIsListening(false);
            onEnd?.();
        };
        recognitionRef.current = recognition;
        return () => {
            recognition.abort();
        };
    }, [
        isSupported,
        language,
        continuous,
        interimResults,
        onTranscript,
        onError,
        onStart,
        onEnd,
    ]);
    const start = React.useCallback(() => {
        if (!recognitionRef.current || isListening)
            return;
        setTranscript("");
        setError(null);
        try {
            recognitionRef.current.start();
        }
        catch {
            console.warn("Speech recognition already started");
        }
    }, [isListening]);
    const stop = React.useCallback(() => {
        if (!recognitionRef.current || !isListening)
            return;
        recognitionRef.current.stop();
    }, [isListening]);
    const toggle = React.useCallback(() => {
        if (isListening) {
            stop();
            return;
        }
        start();
    }, [isListening, start, stop]);
    const clear = React.useCallback(() => {
        setTranscript("");
    }, []);
    return {
        isSupported,
        isListening,
        transcript,
        start,
        stop,
        toggle,
        clear,
        error,
    };
}
function getErrorMessage(error) {
    switch (error) {
        case "no-speech":
            return "No speech detected. Please try again.";
        case "audio-capture":
            return "No microphone found. Please check your device.";
        case "not-allowed":
            return "Microphone permission denied. Please allow access.";
        case "network":
            return "Network error. Please check your connection.";
        case "aborted":
            return "Speech recognition was aborted.";
        case "language-not-supported":
            return "Language not supported.";
        case "service-not-allowed":
            return "Speech recognition service not allowed.";
        default:
            return `Speech recognition error: ${error}`;
    }
}
