import * as React from "react";

type StoryFrameProps = {
  children: React.ReactNode;
  maxWidth?: string;
};

export function StoryFrame({
  children,
  maxWidth = "720px",
}: StoryFrameProps): React.ReactElement {
  return (
    <div className="vf-story-canvas">
      <div className="mx-auto w-full" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}

type ReviewSurfaceProps = {
  children: React.ReactNode;
  label?: string;
  className?: string;
};

export function ReviewSurface({
  children,
  label,
  className = "",
}: ReviewSurfaceProps): React.ReactElement {
  return (
    <section className={`vf-component-surface ${className}`}>
      {label ? <p className="vf-component-label">{label}</p> : null}
      {children}
    </section>
  );
}
