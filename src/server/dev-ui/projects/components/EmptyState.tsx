interface EmptyStateProps {
  title: string;
  description: string;
  variant?: "default" | "error";
  showWorkspaceGuide?: boolean;
}

function WorkspaceGuide(): JSX.Element {
  return (
    <div className="mt-8 max-w-md mx-auto text-left">
      <p className="text-sm font-medium text-gray-500 mb-3">Get started</p>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-600 mb-3">
          Create a project, or place projects in a{" "}
          <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">projects/</code>
          {" "}
          folder:
        </p>
        <pre className="text-xs font-mono text-gray-500 leading-relaxed bg-gray-50 rounded p-3">{
`my-workspace/
  projects/
    site-a/
      app/        ← detected
    site-b/
      app/        ← detected`
        }</pre>
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            Or run{" "}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">
              veryfront init my-app
            </code>{" "}
            to scaffold a new project.
          </p>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  variant = "default",
  showWorkspaceGuide = false,
}: EmptyStateProps): JSX.Element {
  const titleClassName = variant === "error" ? "text-amber-600" : "text-gray-600";
  const showGuide = variant === "default" && showWorkspaceGuide;

  return (
    <div className="text-center py-16 px-6">
      <p className={`text-lg mb-2 ${titleClassName}`}>{title}</p>
      <p className="text-sm text-gray-400">{description}</p>
      {showGuide && <WorkspaceGuide />}
    </div>
  );
}
