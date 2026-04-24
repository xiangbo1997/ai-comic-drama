/**
 * 日志服务
 * 基于 LOG_LEVEL 环境变量过滤日志输出
 */

type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

function getLevel(): number {
  const level = (process.env.LOG_LEVEL || "info") as LogLevel;
  return LEVEL_ORDER[level] ?? LEVEL_ORDER.info;
}

function formatPrefix(level: string, context?: string): string {
  const ts = new Date().toISOString();
  return context
    ? `[${ts}] [${level.toUpperCase()}] [${context}]`
    : `[${ts}] [${level.toUpperCase()}]`;
}

export const logger = {
  debug(message: string, ...args: unknown[]) {
    if (getLevel() <= LEVEL_ORDER.debug) {
      console.debug(formatPrefix("debug"), message, ...args);
    }
  },

  info(message: string, ...args: unknown[]) {
    if (getLevel() <= LEVEL_ORDER.info) {
      console.info(formatPrefix("info"), message, ...args);
    }
  },

  warn(message: string, ...args: unknown[]) {
    if (getLevel() <= LEVEL_ORDER.warn) {
      console.warn(formatPrefix("warn"), message, ...args);
    }
  },

  error(message: string, ...args: unknown[]) {
    if (getLevel() <= LEVEL_ORDER.error) {
      console.error(formatPrefix("error"), message, ...args);
    }
  },
};

/** 创建带上下文的 logger */
export function createLogger(context: string) {
  return {
    debug(message: string, ...args: unknown[]) {
      if (getLevel() <= LEVEL_ORDER.debug) {
        console.debug(formatPrefix("debug", context), message, ...args);
      }
    },
    info(message: string, ...args: unknown[]) {
      if (getLevel() <= LEVEL_ORDER.info) {
        console.info(formatPrefix("info", context), message, ...args);
      }
    },
    warn(message: string, ...args: unknown[]) {
      if (getLevel() <= LEVEL_ORDER.warn) {
        console.warn(formatPrefix("warn", context), message, ...args);
      }
    },
    error(message: string, ...args: unknown[]) {
      if (getLevel() <= LEVEL_ORDER.error) {
        console.error(formatPrefix("error", context), message, ...args);
      }
    },
  };
}
