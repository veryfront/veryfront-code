export function FilterTabs({ tabs = [] }) {
  return (
    <ul className="text-sm md:text-base font-medium flex items-center flex-nowrap scrollbar-hide overflow-x-scroll gap-7 md:gap-8 lg:gap-10">
      {tabs.map((tabs) => (
        <li key={tabs.id} className="flex items-center">
          {tabs.isDisabled ? (
            <span className="py-4 md:py-5 block text-foreground/50 whitespace-nowrap">
              {tabs.title}{" "}
              <span className="bg-highlight ml-2 rounded-full px-2 py-0.5 text-xs font-medium text-muted/50">
                Soon
              </span>
            </span>
          ) : (
            <a
              href={`#${tabs.id}`}
              className="py-4 lg:py-5 block hover:text-primary focus:text-primary outline-none"
            >
              {tabs.title}
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}
