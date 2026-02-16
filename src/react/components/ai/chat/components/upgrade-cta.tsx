import * as React from "react";
import type { InferenceMode } from "#veryfront/agent/react";

const DISMISS_KEY = "vf-upgrade-cta-dismissed";

export interface UpgradeCTAProps {
  inferenceMode: InferenceMode;
}

export function UpgradeCTA({ inferenceMode }: UpgradeCTAProps): React.ReactElement | null {
  const [dismissed, setDismissed] = React.useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (inferenceMode === "cloud" || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // localStorage may be unavailable
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto mt-4 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-sm text-blue-700 dark:text-blue-300 flex items-start gap-3">
      <span className="flex-1">
        Using a lightweight local model. Add an API key to your{" "}
        <code className="px-1 py-0.5 bg-blue-100 dark:bg-blue-900/40 rounded text-xs">.env</code>
        {" "}
        for GPT-4o or Claude.
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        className="text-blue-400 hover:text-blue-600 dark:hover:text-blue-200 transition-colors flex-shrink-0"
        aria-label="Dismiss"
      >
        <svg
          className="size-4"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
