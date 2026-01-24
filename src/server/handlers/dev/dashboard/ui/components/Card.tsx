import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  titleRight?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Card({
  title,
  titleRight,
  children,
  className = "",
}: CardProps): ReactNode {
  return (
    <div
      className={`bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden ${className}`}
    >
      {title
        ? (
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {title}
            </span>
            {titleRight}
          </div>
        )
        : null}
      {children}
    </div>
  );
}
