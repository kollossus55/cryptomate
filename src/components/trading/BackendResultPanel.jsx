import { CheckCircle, AlertTriangle, Activity, Users, TrendingUp, TrendingDown, Zap, Clock } from "lucide-react";

/**
 * Renders the tradingScheduler result in a human-readable summary instead of
 * dumping raw JSON. Falls back gracefully if the shape is unexpected.
 */
export default function BackendResultPanel({ result }) {
  if (!result) return null;

  if (!result.success) {
    return (
      <div className="mt-4 p-3 bg-red-500/10 rounded-lg border border-red-500/30 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-300">Trade check failed</p>
          <p className="text-xs text-red-200/80">{result.error || 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  const { summary = {}, userDetails = [], lastError = [] } = result;
  const trades = summary.trades_executed || 0;
  const errors = summary.errors || 0;
  const usersChecked = summary.users_checked || 0;
  const usersProcessed = summary.users_processed || 0;

  const stats = [
    { label: 'Users Checked', value: usersChecked, icon: Users, color: 'text-blue-400' },
    { label: 'Trades Executed', value: trades, icon: trades > 0 ? TrendingUp : Activity, color: trades > 0 ? 'text-green-400' : 'text-slate-300' },
    { label: 'Errors', value: errors, icon: errors > 0 ? AlertTriangle : CheckCircle, color: errors > 0 ? 'text-red-400' : 'text-green-400' },
  ];

  return (
    <div className="mt-4 p-3 bg-slate-900 rounded-lg border border-slate-700 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-400" />
          <p className="text-xs text-slate-300 font-semibold">Last Trade Check Result</p>
        </div>
        {summary.timestamp && (
          <span className="text-[10px] text-slate-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(summary.timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-slate-800/60 rounded-md p-2 text-center">
              <Icon className={`w-4 h-4 mx-auto mb-1 ${s.color}`} />
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-slate-400">{s.label}</p>
            </div>
          );
        })}
      </div>

      {userDetails && userDetails.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Per-User Activity</p>
          {userDetails.map((u, idx) => (
            <div key={idx} className="flex items-center justify-between bg-slate-800/40 rounded-md px-2 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                {u.halted || u.skipped ? (
                  <span className="text-yellow-400">⏸</span>
                ) : u.trades_executed > 0 ? (
                  <Zap className="w-3 h-3 text-green-400" />
                ) : (
                  <Activity className="w-3 h-3 text-slate-500" />
                )}
                <span className="text-slate-300">
                  {u.trades_executed || 0} trade{u.trades_executed === 1 ? '' : 's'}
                  {u.scanned ? ` · ${u.scanned} scanned` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {u.equity != null && (
                  <span className="text-slate-400">${Number(u.equity).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                )}
                {u.equity_change != null && (
                  <span className={u.equity_change >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {u.equity_change >= 0 ? '+' : ''}{Number(u.equity_change).toFixed(2)}%
                  </span>
                )}
                {(u.halted || u.skipped) && u.reason && (
                  <span className="text-yellow-400/80 text-[10px]">{u.reason}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {lastError && lastError.length > 0 && (
        <div className="space-y-1">
          {lastError.slice(0, 3).map((e, idx) => (
            <div key={idx} className="flex items-start gap-1.5 text-xs text-red-300/80">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>User {e.user_index}: {e.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}