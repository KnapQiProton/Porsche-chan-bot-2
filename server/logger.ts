export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  meta?: any;
}

const recentLogs: LogEntry[] = [];
const MAX_LOGS = 200;

function addLog(level: "info" | "warn" | "error" | "debug", metaOrMsg: any, maybeMsg?: string) {
  let message = "";
  let meta: any = undefined;

  if (typeof metaOrMsg === "string") {
    message = metaOrMsg;
  } else {
    meta = metaOrMsg;
    message = maybeMsg || (meta?.msg ?? "");
  }

  const timestamp = new Date().toISOString();
  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp,
    level,
    message: message || JSON.stringify(meta || {}),
    meta,
  };

  recentLogs.push(entry);
  if (recentLogs.length > MAX_LOGS) {
    recentLogs.shift();
  }

  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (level === "error") {
    console.error(prefix, message, meta !== undefined ? meta : "");
  } else if (level === "warn") {
    console.warn(prefix, message, meta !== undefined ? meta : "");
  } else if (level === "debug") {
    console.debug(prefix, message, meta !== undefined ? meta : "");
  } else {
    console.log(prefix, message, meta !== undefined ? meta : "");
  }
}

export const logger = {
  info: (metaOrMsg: any, msg?: string) => addLog("info", metaOrMsg, msg),
  warn: (metaOrMsg: any, msg?: string) => addLog("warn", metaOrMsg, msg),
  error: (metaOrMsg: any, msg?: string) => addLog("error", metaOrMsg, msg),
  debug: (metaOrMsg: any, msg?: string) => addLog("debug", metaOrMsg, msg),
};

export function getRecentLogs(): LogEntry[] {
  return [...recentLogs];
}
