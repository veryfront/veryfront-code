/**
 * InputBox & SubmitButton Primitives - Layer 2 (Unstyled)
 *
 * Input primitives for chat interfaces.
 * Built on Radix UI patterns (shadcn-compatible).
 */

import * as React from "react";

export interface InputBoxProps extends
  Omit<
    React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement>,
    "onChange" | "onSubmit"
  > {
  /** Current value */
  value: string;

  /** Change handler */
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;

  /** Submit handler */
  onSubmit?: () => void;

  /** Use textarea instead of input */
  multiline?: boolean;
}

/**
 * InputBox - Text input primitive
 *
 * @example
 * ```tsx
 * <InputBox
 *   value={input}
 *   onChange={(e) => setInput(e.target.value)}
 *   onSubmit={handleSubmit}
 *   placeholder="Type a message..."
 *   className="w-full px-4 py-2 border rounded-lg"
 * />
 * ```
 */
export const InputBox = React.forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  InputBoxProps
>(({ className, value, onChange, onSubmit, multiline, ...props }, ref) => {
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (e.key === "Enter" && !e.shiftKey && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  if (multiline) {
    return (
      <textarea
        ref={ref as React.Ref<HTMLTextAreaElement>}
        className={className}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        data-input-box=""
        data-multiline="true"
        rows={3}
        {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
      />
    );
  }

  return (
    <input
      ref={ref as React.Ref<HTMLInputElement>}
      type="text"
      className={className}
      value={value}
      onChange={onChange}
      onKeyDown={handleKeyDown}
      data-input-box=""
      {...props}
    />
  );
});

InputBox.displayName = "InputBox";

export interface SubmitButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Loading/streaming state - shows stop button */
  isLoading?: boolean;

  /** Whether input has text - determines voice vs submit icon */
  hasInput?: boolean;

  /** Handler for stop action */
  onStop?: () => void;

  /** Handler for voice input */
  onVoice?: () => void;

  /** Custom icons */
  icons?: {
    submit?: React.ReactNode;
    stop?: React.ReactNode;
    voice?: React.ReactNode;
  };

  children?: React.ReactNode;
}

/** Default submit icon (paper plane) */
const SubmitIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

/** Default stop icon (square) */
const StopIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

/** Default voice icon (microphone) */
const VoiceIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </svg>
);

/**
 * SubmitButton - Smart submit button with three states
 *
 * States:
 * 1. **Voice** (no input): Shows microphone icon, triggers onVoice
 * 2. **Submit** (has input): Shows arrow icon, submits form
 * 3. **Stop** (loading): Shows stop icon, triggers onStop
 *
 * @example
 * ```tsx
 * <SubmitButton
 *   hasInput={!!input.trim()}
 *   isLoading={isLoading}
 *   onStop={stop}
 *   onVoice={() => console.log('Voice input')}
 *   className="w-9 h-9 bg-blue-500 text-white rounded-full"
 * />
 * ```
 */
export const SubmitButton = React.forwardRef<
  HTMLButtonElement,
  SubmitButtonProps
>((
  { className, isLoading, hasInput, onStop, onVoice, icons, disabled, children, ...props },
  ref,
) => {
  // Determine button state and behavior
  const showStop = isLoading;
  const showVoice = !isLoading && !hasInput && onVoice;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (showStop && onStop) {
      e.preventDefault();
      onStop();
    } else if (showVoice && onVoice) {
      e.preventDefault();
      onVoice();
    }
    // For submit, let form handle it naturally
  };

  // Determine icon to show
  let icon: React.ReactNode;
  let ariaLabel: string;

  if (showStop) {
    icon = icons?.stop || <StopIcon />;
    ariaLabel = "Stop generating";
  } else if (showVoice) {
    icon = icons?.voice || <VoiceIcon />;
    ariaLabel = "Voice input";
  } else {
    icon = icons?.submit || <SubmitIcon />;
    ariaLabel = "Send message";
  }

  return (
    <button
      ref={ref}
      type={showStop || showVoice ? "button" : "submit"}
      className={className}
      disabled={disabled && !showStop}
      onClick={handleClick}
      data-submit-button=""
      data-state={showStop ? "stop" : showVoice ? "voice" : "submit"}
      data-loading={isLoading}
      aria-label={ariaLabel}
      {...props}
    >
      {children || icon}
    </button>
  );
});

SubmitButton.displayName = "SubmitButton";

export interface LoadingIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * LoadingIndicator - Loading spinner primitive
 *
 * @example
 * ```tsx
 * {isLoading && (
 *   <LoadingIndicator className="animate-spin h-4 w-4" />
 * )}
 * ```
 */
export const LoadingIndicator = React.forwardRef<
  HTMLDivElement,
  LoadingIndicatorProps
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={className}
      data-loading-indicator=""
      role="status"
      aria-label="Loading"
      {...props}
    />
  );
});

LoadingIndicator.displayName = "LoadingIndicator";
