import * as dntShim from "../../../_dnt.shims.js";
import * as React from "react";

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

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface GlobalWithSpeechRecognition {
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
}

export function useVoiceInput(
  options: UseVoiceInputOptions = {},
): UseVoiceInputResult {
  const {
    language,
    continuous = false,
    interimResults = true,
    onTranscript,
    onError,
    onStart,
    onEnd,
  } = options;

  const [isListening, setIsListening] = React.useState(false);
  const [transcript, setTranscript] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const recognitionRef = React.useRef<SpeechRecognition | null>(null);

  const isSupported = React.useMemo((): boolean => {
    if (typeof dntShim.dntGlobalThis === "undefined") return false;
    const g = dntShim.dntGlobalThis as unknown as GlobalWithSpeechRecognition;
    return !!(g.SpeechRecognition || g.webkitSpeechRecognition);
  }, []);

  React.useEffect(() => {
    if (!isSupported) return;

    const g = dntShim.dntGlobalThis as unknown as GlobalWithSpeechRecognition;
    const SpeechRecognitionAPI = g.SpeechRecognition ?? g.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    if (language) recognition.lang = language;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const alt = result?.[0];
        if (!alt) continue;

        if (result.isFinal) {
          finalTranscript += alt.transcript;
        } else {
          interimTranscript += alt.transcript;
        }
      }

      const currentTranscript = finalTranscript || interimTranscript;
      setTranscript(currentTranscript);
      onTranscript?.(currentTranscript, !!finalTranscript);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
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

  const start = React.useCallback((): void => {
    if (!recognitionRef.current || isListening) return;

    setTranscript("");
    setError(null);

    try {
      recognitionRef.current.start();
    } catch {
      console.warn("Speech recognition already started");
    }
  }, [isListening]);

  const stop = React.useCallback((): void => {
    if (!recognitionRef.current || !isListening) return;
    recognitionRef.current.stop();
  }, [isListening]);

  const toggle = React.useCallback((): void => {
    if (isListening) {
      stop();
      return;
    }
    start();
  }, [isListening, start, stop]);

  const clear = React.useCallback((): void => {
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

function getErrorMessage(error: string): string {
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
