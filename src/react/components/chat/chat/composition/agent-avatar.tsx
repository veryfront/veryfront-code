/**
 * Agent Avatar — Source-defined agent identity for chat messages.
 *
 * @module react/components/chat/composition/agent-avatar
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import { ModelAvatar } from "./model-avatar.tsx";

/** Props accepted by agent avatar. */
export interface AgentAvatarProps {
  name?: string;
  avatarUrl?: string;
  model?: string;
  className?: string;
}

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

/** Render agent avatar, falling back to model identity when agent identity is absent. */
export function AgentAvatar(
  { name, avatarUrl, model, className }: AgentAvatarProps,
): React.ReactElement {
  const [failed, setFailed] = React.useState(false);
  const base = cn(
    "mt-1 shrink-0 size-8 rounded-full flex items-center justify-center overflow-hidden",
    className,
  );

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        aria-hidden="true"
        className={cn(base, "object-cover")}
        onError={() => setFailed(true)}
      />
    );
  }

  if (name) {
    return (
      <div className={cn(base, "bg-[var(--muted)] text-[var(--foreground)]")}>
        <span className="text-sm font-medium">{getInitial(name)}</span>
      </div>
    );
  }

  return <ModelAvatar model={model} className={className} />;
}
