interface SidebarProps {
  search: string;
  onSearchChange: (value: string) => void;
  subTabs?: { id: string; label: string }[];
  currentSubTab?: string;
  onSubTabChange?: (id: string) => void;
  items: { id: string; label: string; bold?: boolean }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyMessage: string;
  onBack?: () => void;
  backLabel?: string;
}

export function Sidebar({
  search,
  onSearchChange,
  subTabs,
  currentSubTab,
  onSubTabChange,
  items,
  selectedId,
  onSelect,
  emptyMessage,
  onBack,
  backLabel,
}: SidebarProps): React.ReactElement {
  const showSubTabs = !!subTabs && !!onSubTabChange;

  return (
    <aside className="bg-white border-r border-gray-200 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-100">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search..."
          className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded text-sm focus:outline-none focus:border-sky-500 focus:bg-white placeholder:text-gray-400"
        />
      </div>

      {showSubTabs && (
        <div className="flex px-3 py-2 gap-0.5 border-b border-gray-100">
          {subTabs.map((tab) => {
            const isActive = currentSubTab === tab.id;

            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => onSubTabChange(tab.id)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                  isActive
                    ? "bg-sky-50 text-sky-600"
                    : "text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-1.5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="w-full px-2.5 py-2 text-sm text-sky-600 rounded hover:bg-gray-50 flex items-center gap-1.5 text-left"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
            {backLabel ?? ".. (back)"}
          </button>
        )}

        {items.length === 0
          ? (
            <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
              {emptyMessage}
            </div>
          )
          : (
            items.map((item) => {
              const isSelected = selectedId === item.id;

              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  className={`w-full px-2.5 py-2 text-sm rounded flex items-center gap-1.5 text-left transition-colors ${
                    isSelected
                      ? "bg-sky-500 text-white"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  } ${item.bold ? "font-semibold" : ""}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      isSelected ? "bg-white" : "bg-current opacity-30"
                    }`}
                  />
                  {item.label}
                </button>
              );
            })
          )}
      </div>
    </aside>
  );
}
