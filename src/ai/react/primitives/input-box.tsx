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
  /** Loading state */
  isLoading?: boolean;

  children?: React.ReactNode;
}

/**
 * SubmitButton - Submit button primitive
 *
 * @example
 * ```tsx
 * <SubmitButton
 *   onClick={handleSubmit}
 *   isLoading={isLoading}
 *   disabled={!input.trim()}
 *   className="px-4 py-2 bg-blue-600 text-white rounded-lg"
 * >
 *   Send
 * </SubmitButton>
 * ```
 */
export const SubmitButton = React.forwardRef<
  HTMLButtonElement,
  SubmitButtonProps
>(({ className, isLoading, disabled, children, ...props }, ref) => {
  return (
    <button
      ref={ref}
      type="submit"
      className={className}
      disabled={disabled || isLoading}
      data-submit-button=""
      data-loading={isLoading}
      aria-label="Submit message"
      {...props}
    >
      {children || "Send"}
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
