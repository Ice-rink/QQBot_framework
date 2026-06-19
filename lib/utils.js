import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

/**
 * 颜色代码 (ANSI)
 */
export const COLORS = {
  reset: "\x1b[0m",
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
};

/**
 * 日志级别
 */
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
};

/**
 * 日志级别颜色配置
 */
const LEVEL_COLORS = {
  DEBUG: { label: "DEBUG", color: COLORS.gray },
  INFO: { label: "INFO", color: COLORS.brightBlue },
  WARN: { label: "WARN", color: COLORS.brightYellow },
  ERROR: { label: "ERROR", color: COLORS.brightRed },
};

/**
 * Title 颜色配置
 */
export const TITLE_COLORS = {
  QQBot: COLORS.brightCyan,
  Framework: COLORS.brightGreen,
  Gateway: COLORS.brightMagenta,
  API: COLORS.brightBlue,
  Plugin: COLORS.brightYellow,
  TestPlugin: COLORS.brightGreen,
  System: COLORS.white,
  Main: COLORS.brightCyan,
  default: COLORS.white,
};

/**
 * 获取当前时间字符串 (HH:MM:SS.mmm)
 */
function getTimeString() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

/**
 * 日志类 - 支持彩色输出和标题
 */
export class Logger {
  constructor(options = {}) {
    this.level = options.level ?? LOG_LEVELS.INFO;
    this.enableColors = options.enableColors ?? true;
    this.title = options.title ?? "QQBot";
    this.titleColor = TITLE_COLORS[this.title] ?? TITLE_COLORS.default;
    this.logFile = options.logFile ?? null;
    this.maxFileSize = options.maxFileSize ?? 10 * 1024 * 1024;
  }

  setLevel(level) {
    if (typeof level === "string") {
      const upper = level.toUpperCase();
      if (upper in LOG_LEVELS) {
        this.level = LOG_LEVELS[upper];
      }
    } else {
      this.level = level;
    }
    return this;
  }

  setTitle(title, color = null) {
    this.title = title;
    this.titleColor = color || TITLE_COLORS[title] || TITLE_COLORS.default;
    return this;
  }

  setLogFile(filePath) {
    this.logFile = filePath;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return this;
  }

  writeToFile(level, message) {
    if (!this.logFile) return;
    try {
      const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
      if (fs.existsSync(this.logFile)) {
        const stat = fs.statSync(this.logFile);
        if (stat.size > this.maxFileSize) {
          const backup = `${this.logFile}.${Date.now()}.bak`;
          fs.renameSync(this.logFile, backup);
        }
      }
      fs.appendFileSync(this.logFile, line, "utf-8");
    } catch (e) {
      // 静默忽略
    }
  }

  format(level, message, title = null) {
    const time = getTimeString();
    const levelConfig = LEVEL_COLORS[level] || LEVEL_COLORS.INFO;
    const titleStr = title || this.title;
    const titleColor = TITLE_COLORS[titleStr] || this.titleColor;

    if (this.enableColors) {
      const timeColored = COLORS.gray + time + COLORS.reset;
      const levelColored = levelConfig.color + levelConfig.label.padEnd(5) + COLORS.reset;
      const titleColored = titleColor + "[" + titleStr + "]" + COLORS.reset;
      return `${timeColored} ${levelColored} ${titleColored} ${message}`;
    }

    return `${time} ${levelConfig.label.padEnd(5)} [${titleStr}] ${message}`;
  }

  _log(level, message, title = null) {
    if (LOG_LEVELS[level] < this.level) return;
    const formatted = this.format(level, message, title);
    this.writeToFile(level, message);
    console.log(formatted);
  }

  debug(message, title = null) {
    this._log("DEBUG", message, title);
  }

  info(message, title = null) {
    this._log("INFO", message, title);
  }

  warn(message, title = null) {
    this._log("WARN", message, title);
  }

  error(message, title = null) {
    this._log("ERROR", message, title);
  }

  child(title, options = {}) {
    return new Logger({
      level: this.level,
      enableColors: this.enableColors,
      title: title || this.title,
      logFile: this.logFile,
      maxFileSize: this.maxFileSize,
      ...options,
    });
  }
}

/**
 * 配置管理类
 */
export class Config {
  constructor(configPath) {
    this.configPath = configPath || process.env.QQBOT_CONFIG || "./config.json";
    this.config = null;
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        this.config = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
        const log = new Logger({ title: "Config" });
        log.info(`配置已加载: ${this.configPath}`);
        return this.config;
      }
    } catch (e) {
      const log = new Logger({ title: "Config" });
      log.error(`加载配置失败: ${e.message}`);
    }
    return null;
  }

  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      const log = new Logger({ title: "Config" });
      log.debug(`配置已保存: ${this.configPath}`);
    } catch (e) {
      const log = new Logger({ title: "Config" });
      log.error(`保存配置失败: ${e.message}`);
    }
  }

  get(key) {
    if (!this.config) return undefined;
    return key.split(".").reduce((obj, k) => obj?.[k], this.config);
  }

  set(key, value) {
    if (!this.config) this.config = {};
    const parts = key.split(".");
    let obj = this.config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    this.save();
  }

  delete(key) {
    if (!this.config) return;
    const parts = key.split(".");
    let obj = this.config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) return;
      obj = obj[parts[i]];
    }
    delete obj[parts[parts.length - 1]];
    this.save();
  }

  getAll() {
    return this.config;
  }
}

/**
 * 默认日志实例
 */
export const logger = new Logger({
  level: process.env.LOG_LEVEL ? LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] : LOG_LEVELS.INFO,
  enableColors: process.env.NO_COLOR ? false : true,
  title: "QQBot",
});

/**
 * 快速创建带标题的日志
 */
export function createLogger(title, options = {}) {
  return new Logger({ title, ...options });
}

/**
 * 获取主目录
 */
export function getHomeDir() {
  return os.homedir() || process.env.HOME || process.env.USERPROFILE || "/tmp";
}

/**
 * 展开波浪号路径
 */
export function expandTilde(p) {
  if (!p) return p;
  if (p === "~") return getHomeDir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(getHomeDir(), p.slice(2));
  }
  return p;
}

/**
 * 延迟函数
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 重试装饰器
 */
export async function retry(fn, maxRetries = 3, delay = 1000) {
  let lastError;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < maxRetries) {
        const log = new Logger({ title: "Retry" });
        log.debug(`重试 ${i + 1}/${maxRetries}: ${e.message}`);
        await sleep(delay * Math.pow(2, i));
      }
    }
  }
  throw lastError;
}

/**
 * 获取消息序号 (0-65535)
 */
export function getNextMsgSeq() {
  return (Date.now() % 100000000 ^ Math.floor(Math.random() * 65536)) % 65536;
}