import { cn } from "@/shared/utils/utils"
import React from "react"

type User = any

function getInitials(name: string) {
  if (!name) {
    return "?"
  }

  const [firstName, lastName] = name.split(" ")
  const initials = [firstName.charAt(0), lastName?.charAt(0)]
    .filter(Boolean)
    .join("")

  return initials
}

interface UserAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  user: User
  accentColor?: string
}

export const UserAvatar = React.forwardRef<HTMLDivElement, UserAvatarProps>(
  ({ className, user, accentColor, ...props }, ref) => {
    if (!user) {
      return null
    }

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-full size-8 flex items-center justify-center bg-highlight",
          user &&
            accentColor &&
            "bg-[var(--accent-color)] border-2 border-[var(--accent-color)]",
          className,
        )}
        style={{
          "--accent-color": accentColor,
        }}
        {...props}
      >
        {user.avatarSrc ? (
          <img
            src={user.avatarSrc}
            alt={user.name}
            className="w-full h-full rounded-full overflow-hidden object-cover"
          />
        ) : (
          <span className="capitalize w-full h-full flex items-center justify-center font-medium text-sm text-center leading-none rounded-full">
            {getInitials(user.name)}
          </span>
        )}
      </div>
    )
  },
)
