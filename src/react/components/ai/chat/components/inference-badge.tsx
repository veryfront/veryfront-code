import * as React from "react";
import type { BrowserInferenceStatus, InferenceMode } from "#veryfront/agent/react";

export interface InferenceBadgeProps {
  inferenceMode: InferenceMode;
  browserStatus?: BrowserInferenceStatus | null;
}

export function InferenceBadge({
  inferenceMode,
  browserStatus,
}: InferenceBadgeProps): React.ReactElement | null {
  if (inferenceMode === "cloud") return null;

  let label: string;
  let dotColor: string;
  let showProgress = false;

  if (inferenceMode === "server-local") {
    label = "Running locally";
    dotColor = "bg-green-500";
  } else if (browserStatus === "downloading-model") {
    label = "Downloading model...";
    dotColor = "bg-amber-500";
    showProgress = true;
  } else if (browserStatus === "loading-runtime") {
    label = "Loading AI runtime...";
    dotColor = "bg-amber-500";
  } else if (browserStatus === "generating") {
    label = "Running in browser";
    dotColor = "bg-green-500";
  } else if (browserStatus === "error") {
    label = "Local model failed";
    dotColor = "bg-red-500";
  } else {
    label = "Running locally";
    dotColor = "bg-green-500";
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-neutral-500 dark:text-neutral-400">
      <span
        className={`size-1.5 rounded-full ${dotColor} ${showProgress ? "animate-pulse" : ""}`}
      />
      <span>{label}</span>
    </div>
  );
}
