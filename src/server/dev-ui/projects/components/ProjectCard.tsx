interface ProjectCardProps {
  name: string;
  slug: string;
  description?: string;
  updatedAt?: string;
  href: string;
}

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return "";

  const date = new Date(dateString);
  const diffSecs = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diffSecs < 60) return "just now";

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins === 1) return "1 minute ago";
  if (diffMins < 60) return `${diffMins} minutes ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return "1 hour ago";
  if (diffHours < 24) return `${diffHours} hours ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return "1 week ago";
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ProjectCard({
  name,
  slug,
  description,
  updatedAt,
  href,
}: ProjectCardProps): JSX.Element {
  const relativeTime = formatRelativeTime(updatedAt);

  return (
    <a
      href={href}
      className="block bg-vf-card rounded-xl p-5 border border-vf-border hover:border-[#ccc] transition-colors"
    >
      <h3 className="text-lg font-semibold text-vf-text leading-tight">{name}</h3>
      <p className="text-sm text-[#1a1a1a]/50 mt-1">{slug}</p>
      {description && <p className="text-sm text-vf-muted mt-2 line-clamp-2">{description}</p>}
      {relativeTime && <p className="text-xs text-[#999] mt-2">Updated {relativeTime}</p>}
    </a>
  );
}
