export default function Loading() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-neutral-500 dark:text-neutral-400 text-sm">Loading docs...</p>
      </div>
    </div>
  );
}
