import React from "react";

export function generateBlurDataURL(
  width: number = 10,
  height: number = 10,
  color: string = "#cccccc",
): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="${color}"/>
    </svg>
  `;

  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function getAspectRatioPadding(width: number, height: number): string {
  return `${(height / width) * 100}%`;
}

export function ResponsiveImageContainer({
  width,
  height,
  children,
  className,
  style,
}: {
  width: number;
  height: number;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const containerStyle = {
    position: "relative" as const,
    width: "100%",
    paddingBottom: getAspectRatioPadding(width, height),
    ...style,
  };

  const contentStyle = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
  } as const;

  return (
    <div className={className} style={containerStyle}>
      <div style={contentStyle}>{children}</div>
    </div>
  );
}
