export function APITab(): JSX.Element {
  return (
    <div className="h-[calc(100vh-89px)] overflow-y-auto">
      <main className="bg-gray-50 p-5">
        <div className="mb-6">
          <h1 className="text-lg font-semibold tracking-tight">API Documentation</h1>
          <p className="text-sm text-gray-500">
            Interactive API docs powered by Scalar.{" "}
            <a
              href="/_docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-500 hover:text-sky-600"
            >
              Open in new tab
            </a>
          </p>
        </div>

        <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
          <iframe
            src="/_docs"
            className="w-full border-0"
            style={{ height: "calc(100vh - 180px)" }}
          />
        </div>
      </main>
    </div>
  );
}
