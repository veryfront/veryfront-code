export function Header() {
  return (
    <header className="bg-white border-b border-gray-200 px-5 h-12 flex items-center sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-sky-500 rounded flex items-center justify-center text-white font-bold text-xs">
          V
        </div>
        <span className="font-semibold text-sm tracking-tight">Dev</span>
      </div>
    </header>
  );
}
