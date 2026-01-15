interface EmptyStateProps {
  title: string;
  description: string;
  variant?: "default" | "error";
}

export function EmptyState({ title, description, variant = "default" }: EmptyStateProps) {
  return (
    <div className="text-center py-16 px-6">
      <p
        className={`text-lg mb-2 ${variant === "error" ? "text-amber-600" : "text-gray-600"}`}
      >
        {title}
      </p>
      <p className="text-sm text-gray-400">{description}</p>
    </div>
  );
}
