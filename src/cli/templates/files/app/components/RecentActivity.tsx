import { getRecentActivity } from "../lib/stats.ts";

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
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

function getActivityColor(type: string) {
  const colors: Record<string, string> = {
    login: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    purchase: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    signup: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-violet-200 dark:border-violet-800",
    update: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    default: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-600",
  };
  return colors[type.toLowerCase()] || colors.default;
}

export async function RecentActivity({ userId }: { userId: string }) {
  const activities = await getRecentActivity(userId);

  return (
    <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-lg rounded-2xl shadow-sm border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between bg-white/50 dark:bg-slate-800/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <ActivityIcon className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Recent Activity</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Latest actions from your users</p>
          </div>
        </div>
        <a
          href="/dashboard/activity"
          className="px-4 py-2 rounded-lg text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
        >
          View all
        </a>
      </div>

      {/* Activity List */}
      <div className="divide-y divide-slate-200/50 dark:divide-slate-700/50">
        {activities.map((activity) => (
          <div key={activity.id} className="p-6 hover:bg-white/50 dark:hover:bg-slate-700/30 transition-colors group">
            <div className="flex items-start gap-4">
              {/* Time indicator */}
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/20 transition-colors">
                <ClockIcon className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {activity.description}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                  <ClockIcon className="w-3 h-3" />
                  {new Date(activity.timestamp).toLocaleString()}
                </p>
              </div>

              {/* Type badge */}
              <span className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold border ${getActivityColor(activity.type)}`}>
                {activity.type}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {activities.length === 0 && (
        <div className="p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <ActivityIcon className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          </div>
          <p className="text-slate-500 dark:text-slate-400 font-medium">No recent activity</p>
        </div>
      )}
    </div>
  );
}