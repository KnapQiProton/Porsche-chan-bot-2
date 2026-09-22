import React, { useState, useEffect } from "react";
import { Terminal, RefreshCw, Filter, Trash2, CheckCircle2, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { LogEntry } from "../types";

export const LiveLogs: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedLevel, setSelectedLevel] = useState<string>("all");

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/bot/logs");
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.warn("Logs endpoint temporarily unavailable during startup:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    if (!autoRefresh) return;

    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const filteredLogs = logs.filter((log) => {
    if (selectedLevel === "all") return true;
    return log.level === selectedLevel;
  });

  const getLevelBadge = (level: string) => {
    switch (level) {
      case "error":
        return (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-mono font-semibold">
            <AlertCircle className="w-3 h-3" /> ERROR
          </span>
        );
      case "warn":
        return (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-mono font-semibold">
            <AlertTriangle className="w-3 h-3" /> WARN
          </span>
        );
      case "debug":
        return (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-mono font-semibold">
            DEBUG
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono font-semibold">
            <Info className="w-3 h-3" /> INFO
          </span>
        );
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-slate-600" />
            <span className="text-sm font-semibold text-slate-900">
              Bot & Server Real-time Logs
            </span>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
            {["all", "info", "warn", "error"].map((lvl) => (
              <button
                key={lvl}
                onClick={() => setSelectedLevel(lvl)}
                className={`px-2 py-0.5 rounded-lg capitalize transition-all ${
                  selectedLevel === lvl
                    ? "bg-white text-slate-900 shadow-xs font-medium"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Auto-refresh (3s)</span>
          </label>

          <button
            onClick={fetchLogs}
            disabled={loading}
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            title="Refresh logs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Log Terminal Window */}
      <div className="bg-slate-950 text-slate-200 rounded-2xl border border-slate-800 p-4 font-mono text-xs shadow-md h-[550px] overflow-y-auto space-y-2 scrollbar-thin">
        {filteredLogs.length === 0 ? (
          <div className="text-slate-500 text-center py-20 italic">
            Belum ada log tercatat. Kirim chat atau gunakan fitur untuk melihat aktivitas.
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-2.5 py-1 border-b border-slate-900/60 hover:bg-slate-900/40 px-1.5 rounded transition-colors"
            >
              <span className="text-slate-500 shrink-0 select-none">
                {log.timestamp.split("T")[1]?.slice(0, 8)}
              </span>
              <span className="shrink-0">{getLevelBadge(log.level)}</span>
              <div className="flex-1 overflow-x-auto">
                <span className="text-slate-100">{log.message}</span>
                {log.meta && Object.keys(log.meta).length > 0 && (
                  <pre className="text-[11px] text-slate-400 mt-0.5 overflow-x-auto">
                    {JSON.stringify(log.meta, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
