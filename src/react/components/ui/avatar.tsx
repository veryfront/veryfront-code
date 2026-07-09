/**
 * Avatar — ported 1:1 from Veryfront Studio's `UserAvatar`. The one generic
 * avatar for users, agents, and entities: shows an image when available, else
 * initials (two-letter for `primary` tone, single capital for `muted`).
 * Studio's `vf-avatar-initial` container-query sizing is simplified to a fixed
 * `text-xs` for v1. Private to the chat module.
 *
 * @module react/components/ui/avatar
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

function getInitials(name: string): string {
  if (!name) return "?";
  const [firstName, lastName] = name.split(" ");
  return [firstName?.charAt(0), lastName?.charAt(0)].filter(Boolean).join("");
}

function getSingleInitial(name: string): string {
  const trimmed = name?.trim?.() ?? "";
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
}

/** Props accepted by `<Avatar>`. */
export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  avatarSrc?: string;
  accentColor?: string;
  /** `filled` fills with accent (default); `bordered` shows an accent ring. */
  variant?: "filled" | "bordered";
  /** `primary` brand bg + two-letter initials; `muted` grey bg + one letter. */
  tone?: "primary" | "muted";
  ref?: React.Ref<HTMLDivElement>;
}

/** Render a user / agent / entity avatar. */
export function Avatar({
  className,
  style,
  name,
  avatarSrc,
  accentColor,
  variant = "filled",
  tone = "primary",
  ref,
  ...props
}: AvatarProps): React.ReactElement {
  const isBordered = variant === "bordered";
  const isMuted = tone === "muted" && !accentColor;
  const [imageFailed, setImageFailed] = React.useState(false);

  React.useEffect(() => {
    setImageFailed(false);
  }, [avatarSrc]);

  const showImage = Boolean(avatarSrc) && !imageFailed;

  const accentStyle: React.CSSProperties | undefined = accentColor
    ? isBordered
      ? { borderColor: accentColor }
      : { backgroundColor: accentColor, borderColor: accentColor }
    : undefined;

  return (
    <div
      ref={ref}
      className={cn(
        "@container rounded-full size-8 shrink-0 flex items-center justify-center overflow-hidden",
        isMuted ? "bg-[var(--accent)]" : "bg-[var(--primary)]",
        accentColor && "border",
        className,
      )}
      style={{ ...accentStyle, ...style }}
      {...props}
    >
      {showImage
        ? (
          <img
            src={avatarSrc}
            alt={name}
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="w-full h-full rounded-full object-cover"
          />
        )
        : (
          <span
            className={cn(
              // Scale the initial to the avatar via container-query units, so it
              // fills small pills AND large empty-state avatars (Studio parity).
              "w-full h-full flex items-center justify-center font-medium capitalize leading-none",
              isMuted
                ? "text-[length:44cqw] text-[var(--foreground)]"
                : "text-[length:34cqw] text-white",
            )}
          >
            {isMuted ? getSingleInitial(name) : getInitials(name)}
          </span>
        )}
    </div>
  );
}
