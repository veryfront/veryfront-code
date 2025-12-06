import { getStats } from "../lib/stats.ts";

// Stat Icons
function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
}

function DollarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  );
}

function TrendingUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  );
}

function TrendingDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
      <polyline points="17 18 23 18 23 12"/>
    </svg>
  );
}

export async function StatsGrid({ userId }: { userId: string }) {
  const stats = await getStats(userId);

  const items = [
    {
      label: "Total Users",
      value: stats.totalUsers.toLocaleString(),
      change: "+12%",
      trend: "up",
      Icon: UsersIcon,
      color: "from-blue-500 to-cyan-500",
      bgColor: "bg-blue-500/10",
      shadowColor: "shadow-blue-500/20",
    },
    {
      label: "Active Today",
      value: stats.activeToday.toLocaleString(),
      change: "+5%",
      trend: "up",
      Icon: ActivityIcon,
      color: "from-emerald-500 to-teal-500",
      bgColor: "bg-emerald-500/10",
      shadowColor: "shadow-emerald-500/20",
    },
    {
      label: "Revenue",
      value: "$" + stats.revenue.toLocaleString(),
      change: "+8%",
      trend: "up",
      Icon: DollarIcon,
      color: "from-violet-500 to-purple-500",
      bgColor: "bg-violet-500/10",
      shadowColor: "shadow-violet-500/20",
    },
    {
      label: "Growth Rate",
      value: stats.growth + "%",
      change: "+2.3%",
      trend: "up",
      Icon: TrendingUpIcon,
      color: "from-orange-500 to-amber-500",
      bgColor: "bg-orange-500/10",
      shadowColor: "shadow-orange-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {items.map((item) => (
        <div
          key={item.label}
          className="group bg-white/60 dark:bg-slate-800/60 backdrop-blur-lg p-6 rounded-2xl shadow-sm border border-slate-200/50 dark:border-slate-700/50 hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
        >
          <div className="flex items-center justify-between mb-4">
            <div className={`w-12 h-12 rounded-xl ${item.bgColor} flex items-center justify-center group-hover:scale-110 transition-transform duration-300 ${item.shadowColor} shadow-lg`}>
              <item.Icon className={`w-6 h-6 bg-gradient-to-r ${item.color}`} style={{ stroke: 'currentColor' }} />
            </div>
            <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
              item.trend === "up"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
            }`}>
              {item.trend === "up" ? (
                <TrendingUpIcon className="w-3 h-3" />
              ) : (
                <TrendingDownIcon className="w-3 h-3" />
              )}
              {item.change}
            </div>
          </div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">{item.label}</p>
          <p className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{item.value}</p>
        </div>
      ))}
    </div>
  );
}