import * as React from "react";

// SSR-safe layout effect: run before paint on the client (so the textarea's
// auto-resize height is applied in the same frame as hydration — no visible
// jump), and fall back to a no-op effect on the server.
const useIsomorphicLayoutEffect = typeof document !== "undefined"
  ? React.useLayoutEffect
  : React.useEffect;

function assignRef<T>(
  ref: React.ForwardedRef<T>,
  value: T | null,
): (() => void) | undefined {
  if (typeof ref === "function") {
    const cleanup = ref(value);
    return typeof cleanup === "function" ? cleanup : undefined;
  } else if (ref) {
    ref.current = value;
  }
  return undefined;
}

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

/** @internal Shared key handling kept pure so IME behavior is deterministic. */
export function handleInputBoxKeyDown(
  e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  onKeyDown: InputBoxProps["onKeyDown"],
  onSubmit: InputBoxProps["onSubmit"],
): void {
  onKeyDown?.(e);
  if (e.defaultPrevented) return;

  const nativeEvent = e.nativeEvent as KeyboardEvent | undefined;
  const isComposing = nativeEvent?.isComposing === true ||
    (e as { isComposing?: boolean }).isComposing === true ||
    e.keyCode === 229;
  if (e.key !== "Enter" || e.shiftKey || isComposing || !onSubmit) return;

  e.preventDefault();
  onSubmit();
}

export const InputBox = React.forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  InputBoxProps
>(({ className, value, onChange, onSubmit, multiline, onKeyDown, ...props }, ref) => {
  const internalRef = React.useRef<HTMLTextAreaElement>(null);
  const mergedTextareaRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      internalRef.current = node;
      const cleanupExternalRef = assignRef(
        ref as React.ForwardedRef<HTMLTextAreaElement>,
        node,
      );
      return () => {
        internalRef.current = null;
        if (cleanupExternalRef) cleanupExternalRef();
        else assignRef(ref as React.ForwardedRef<HTMLTextAreaElement>, null);
      };
    },
    [ref],
  );

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    handleInputBoxKeyDown(e, onKeyDown, onSubmit);
  };

  // Auto-resize textarea to fit content. Runs in a layout effect (before paint)
  // so the height is set in the same frame as hydration — the fixed `min-h`
  // class on the textarea holds the SSR height, so there is no post-hydration
  // jump.
  useIsomorphicLayoutEffect(() => {
    const el = internalRef.current;
    if (!el || !multiline) return;
    el.style.height = "auto";
    if (value) {
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [value, multiline]);

  if (multiline) {
    return (
      <textarea
        ref={mergedTextareaRef}
        className={className}
        // The auto-resize height is applied client-side only, so the inline
        // `height` differs between SSR and first client render.
        suppressHydrationWarning
        style={{ resize: "none", border: "none", outline: "none" }}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        data-input-box=""
        data-multiline="true"
        rows={1}
        {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
      />
    );
  }

  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
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
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
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
      onClick,
      type,
      "aria-label": ariaLabelProp,
      ...props
    },
    ref,
  ) => {
    const showStop = !!isLoading;
    const showVoice = !showStop && !hasInput && !!onVoice;

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
      onClick?.(e);
      if (e.defaultPrevented) return;

      if (showStop) {
        if (!onStop) return;
        e.preventDefault();
        onStop();
        return;
      }

      if (!showVoice || !onVoice) return;
      e.preventDefault();
      onVoice();
    };

    const { icon, ariaLabel, state } = (() => {
      if (showStop) {
        return {
          icon: icons?.stop ?? <StopIcon />,
          ariaLabel: "Stop generating",
          state: "stop" as const,
        };
      }

      if (showVoice) {
        return {
          icon: icons?.voice ?? <VoiceIcon />,
          ariaLabel: "Voice input",
          state: "voice" as const,
        };
      }

      return {
        icon: icons?.submit ?? <SubmitIcon />,
        ariaLabel: "Send message",
        state: "submit" as const,
      };
    })();
    const buttonType = showStop || showVoice ? "button" : (type ?? "submit");
    const isDisabled = showStop ? false : disabled;

    return (
      <button
        {...props}
        ref={ref}
        type={buttonType}
        className={className}
        disabled={isDisabled}
        onClick={handleClick}
        data-submit-button=""
        data-state={state}
        data-loading={isLoading}
        aria-label={ariaLabelProp ?? ariaLabel}
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
