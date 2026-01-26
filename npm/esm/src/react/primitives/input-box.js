import * as React from "react";
export const InputBox = React.forwardRef(({ className, value, onChange, onSubmit, multiline, ...props }, ref) => {
    const handleKeyDown = (e) => {
        if (e.key !== "Enter" || e.shiftKey || !onSubmit)
            return;
        e.preventDefault();
        onSubmit();
    };
    if (multiline) {
        return (React.createElement("textarea", { ref: ref, className: className, value: value, onChange: onChange, onKeyDown: handleKeyDown, "data-input-box": "", "data-multiline": "true", rows: 3, ...props }));
    }
    return (React.createElement("input", { ref: ref, type: "text", className: className, value: value, onChange: onChange, onKeyDown: handleKeyDown, "data-input-box": "", ...props }));
});
InputBox.displayName = "InputBox";
function SubmitIcon() {
    return (React.createElement("svg", { className: "w-4 h-4", viewBox: "0 0 24 24", fill: "currentColor" },
        React.createElement("path", { d: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" })));
}
function StopIcon() {
    return (React.createElement("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "currentColor" },
        React.createElement("rect", { x: "4", y: "4", width: "16", height: "16", rx: "2" })));
}
function VoiceIcon() {
    return (React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" },
        React.createElement("path", { d: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" }),
        React.createElement("path", { d: "M19 10v2a7 7 0 0 1-14 0v-2" }),
        React.createElement("line", { x1: "12", x2: "12", y1: "19", y2: "22" })));
}
export const SubmitButton = React.forwardRef(({ className, isLoading, hasInput, onStop, onVoice, icons, disabled, children, ...props }, ref) => {
    const showStop = !!isLoading;
    const showVoice = !showStop && !hasInput && !!onVoice;
    const handleClick = (e) => {
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
    let icon;
    let ariaLabel;
    let state;
    if (showStop) {
        icon = icons?.stop ?? React.createElement(StopIcon, null);
        ariaLabel = "Stop generating";
        state = "stop";
    }
    else if (showVoice) {
        icon = icons?.voice ?? React.createElement(VoiceIcon, null);
        ariaLabel = "Voice input";
        state = "voice";
    }
    else {
        icon = icons?.submit ?? React.createElement(SubmitIcon, null);
        ariaLabel = "Send message";
        state = "submit";
    }
    return (React.createElement("button", { ref: ref, type: showStop || showVoice ? "button" : "submit", className: className, disabled: disabled && !showStop, onClick: handleClick, "data-submit-button": "", "data-state": state, "data-loading": isLoading, "aria-label": ariaLabel, ...props }, children ?? icon));
});
SubmitButton.displayName = "SubmitButton";
export const LoadingIndicator = React.forwardRef(({ className, ...props }, ref) => (React.createElement("div", { ref: ref, className: className, "data-loading-indicator": "", role: "status", "aria-label": "Loading", ...props })));
LoadingIndicator.displayName = "LoadingIndicator";
