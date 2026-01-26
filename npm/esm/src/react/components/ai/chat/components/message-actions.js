import * as dntShim from "../../../../../../_dnt.shims.js";
import * as React from "react";
import { cn } from "../../theme.js";
import { CheckIcon, CopyIcon } from "../../icons/index.js";
export function MessageActions({ content, className, }) {
    const [copied, setCopied] = React.useState(false);
    const setCopiedWithTimeout = React.useCallback(() => {
        setCopied(true);
        dntShim.setTimeout(() => setCopied(false), 2000);
    }, []);
    const fallbackCopy = React.useCallback(() => {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
    }, [content]);
    const handleCopy = React.useCallback(async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopiedWithTimeout();
        }
        catch {
            // Fallback for older browsers
            fallbackCopy();
            setCopiedWithTimeout();
        }
    }, [content, fallbackCopy, setCopiedWithTimeout]);
    return (React.createElement("div", { className: cn("flex items-center gap-1 mt-2", className) },
        React.createElement("button", { type: "button", onClick: handleCopy, className: "inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors", title: copied ? "Copied!" : "Copy to clipboard" }, copied
            ? (React.createElement(React.Fragment, null,
                React.createElement(CheckIcon, { className: "size-3" }),
                React.createElement("span", null, "Copied")))
            : (React.createElement(React.Fragment, null,
                React.createElement(CopyIcon, { className: "size-3" }),
                React.createElement("span", null, "Copy"))))));
}
