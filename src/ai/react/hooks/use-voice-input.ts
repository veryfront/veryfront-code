
import * as React from "react";

export interface UseVoiceInputOptions {
  language?: string;

  continuous?: boolean;

  interimResults?: boolean;

  onTranscript?: (transcript: string, isFinal: boolean) => void;

  onError?: (error: string) => void;

  onStart?: () => void;

  onEnd?: () => void;
}

export interface UseVoiceInputResult {
  isSupported: boolean;

  isListening: boolean;

  transcript: string;

  start: () => void;

  stop: () => void;

  toggle: () => void;

  clear: () => void;

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

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
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

  const isSupported = React.useMemo(() => {
    if (typeof globalThis === "undefined") return false;
    // deno-lint-ignore no-explicit-any
    const g = globalThis as any;
    return !!(g.SpeechRecognition || g.webkitSpeechRecognition);
  }, []);

  React.useEffect(() => {
    if (!isSupported) return;

    // deno-lint-ignore no-explicit-any
    const g = globalThis as any;
    const SpeechRecognitionAPI = g.SpeechRecognition || g.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;

    if (language) {
      recognition.lang = language;
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result || !result[0]) continue;

        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      const currentTranscript = finalTranscript || interimTranscript;
      setTranscript(currentTranscript);

      if (onTranscript) {
        onTranscript(currentTranscript, !!finalTranscript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const errorMessage = getErrorMessage(event.error);
      setError(errorMessage);
      setIsListening(false);

      if (onError) {
        onError(errorMessage);
      }
    };

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);

      if (onStart) {
        onStart();
      }
    };

    recognition.onend = () => {
      setIsListening(false);

      if (onEnd) {
        onEnd();
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
    };
  }, [isSupported, language, continuous, interimResults, onTranscript, onError, onStart, onEnd]);

  const start = React.useCallback(() => {
    if (!recognitionRef.current || isListening) return;

    setTranscript("");
    setError(null);

    try {
      recognitionRef.current.start();
    } catch {
      console.warn("Speech recognition already started");
    }
  }, [isListening]);

  const stop = React.useCallback(() => {
    if (!recognitionRef.current || !isListening) return;

    recognitionRef.current.stop();
  }, [isListening]);

  const toggle = React.useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
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
