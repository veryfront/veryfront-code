import * as React from "react";

export interface InputBoxProps extends
  Omit<
    React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement>,
    "onChange" | "onSubmit"
  > {
  value: string;
  onChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onSubmit?: () => void;
  multiline?: boolean;
}

export const InputBox = React.forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  InputBoxProps
>(({ className, value, onChange, onSubmit, multiline, ...props }, ref) => {
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    if (e.key !== "Enter" || e.shiftKey || !onSubmit) return;
    e.preventDefault();
    onSubmit();
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
  isLoading?: boolean;
  hasInput?: boolean;
  onStop?: () => void;
  onVoice?: () => void;
  icons?: {
    submit?: React.ReactNode;
    stop?: React.ReactNode;
    voice?: React.ReactNode;
  };
  children?: React.ReactNode;
}

function SubmitIcon(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}

function StopIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function VoiceIcon(): React.JSX.Element {
  return (
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
}

export const SubmitButton = React.forwardRef<
  HTMLButtonElement,
  SubmitButtonProps
>(
  (
    {
      className,
      isLoading,
      hasInput,
      onStop,
      onVoice,
      icons,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const showStop = !!isLoading;
    const showVoice = !showStop && !hasInput && !!onVoice;

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
      if (showStop && onStop) {
        e.preventDefault();
        onStop();
        return;
      }

      if (showVoice && onVoice) {
        e.preventDefault();
        onVoice();
      }
    };

    let icon: React.ReactNode;
    let ariaLabel: string;
    let state: "stop" | "voice" | "submit";

    if (showStop) {
      icon = icons?.stop ?? <StopIcon />;
      ariaLabel = "Stop generating";
      state = "stop";
    } else if (showVoice) {
      icon = icons?.voice ?? <VoiceIcon />;
      ariaLabel = "Voice input";
      state = "voice";
    } else {
      icon = icons?.submit ?? <SubmitIcon />;
      ariaLabel = "Send message";
      state = "submit";
    }

    return (
      <button
        ref={ref}
        type={showStop || showVoice ? "button" : "submit"}
        className={className}
        disabled={disabled && !showStop}
        onClick={handleClick}
        data-submit-button=""
        data-state={state}
        data-loading={isLoading}
        aria-label={ariaLabel}
        {...props}
      >
        {children ?? icon}
      </button>
    );
  },
);

SubmitButton.displayName = "SubmitButton";

export interface LoadingIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {}

export const LoadingIndicator = React.forwardRef<
  HTMLDivElement,
  LoadingIndicatorProps
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={className}
    data-loading-indicator=""
    role="status"
    aria-label="Loading"
    {...props}
  />
));

LoadingIndicator.displayName = "LoadingIndicator";
