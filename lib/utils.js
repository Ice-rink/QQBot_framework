import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

// ============ 颜色代码 ============

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

// ============ 日志级别 ============

export const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
};

const LEVEL_COLORS = {
    DEBUG: { label: "DEBUG", color: COLORS.gray },
    INFO: { label: "INFO", color: COLORS.brightBlue },
    WARN: { label: "WARN", color: COLORS.brightYellow },
    ERROR: { label: "ERROR", color: COLORS.brightRed },
};

export const TITLE_COLORS = {
    QQBot: COLORS.cyan,
    Framework: COLORS.green,
    Gateway: COLORS.magenta,
    API: COLORS.blue,
    Plugin: COLORS.yellow,
    TestPlugin: COLORS.green,
    System: COLORS.gray,
    Main: COLORS.cyan,
    Config: COLORS.blue,
    Backend: COLORS.magenta,
    default: COLORS.white,
};

// ============ 日志类 ============

function getTimeString() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    const s = String(now.getSeconds()).padStart(2, "0");
    const ms = String(now.getMilliseconds()).padStart(3, "0");
    return `${h}:${m}:${s}.${ms}`;
}

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
            const msgColored = COLORS.white + message + COLORS.reset;
            return `${timeColored} ${levelColored} ${titleColored} ${msgColored}`;
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

// ============ 默认日志实例 ============

export const logger = new Logger({
    level: process.env.LOG_LEVEL ? LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] : LOG_LEVELS.INFO,
    enableColors: process.env.NO_COLOR ? false : true,
    title: "QQBot",
});

export function createLogger(title, options = {}) {
    return new Logger({ title, ...options });
}

// ============ 配置管理 ============

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

// ============ 工具函数 ============

export function getHomeDir() {
    return os.homedir() || process.env.HOME || process.env.USERPROFILE || "/tmp";
}

export function expandTilde(p) {
    if (!p) return p;
    if (p === "~") return getHomeDir();
    if (p.startsWith("~/") || p.startsWith("~\\")) {
        return path.join(getHomeDir(), p.slice(2));
    }
    return p;
}

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// ============ 关键: 导出 getNextMsgSeq ============

/**
 * 获取消息序号 (0-65535)
 * 用于 QQ Bot API 的 msg_seq 字段
 */
export function getNextMsgSeq() {
    const timePart = Date.now() % 100000000;
    const random = Math.floor(Math.random() * 65536);
    return (timePart ^ random) % 65536;
}

// ============ 后台指令系统 ============

const BACKEND_COMMANDS = new Map();

export function registerBackendCommand(name, description, handler) {
    const key = name.toLowerCase();
    BACKEND_COMMANDS.set(key, { description, handler });
    const log = new Logger({ title: "Backend" });
    log.debug(`注册后台指令: ${name}`);
    return true;
}

export function getBackendCommands() {
    return Array.from(BACKEND_COMMANDS.keys());
}

export async function executeBackendCommand(input) {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const parts = trimmed.split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const args = parts.slice(1);

    const cmd = BACKEND_COMMANDS.get(cmdName);
    if (!cmd) {
        const log = new Logger({ title: "Main" });
        log.error(`未知的指令 "${cmdName}"，请确保指令是否存在`);
        return {
            error: true,
            message: `未知的指令 "${cmdName}"，请确保指令是否存在`
        };
    }

    try {
        const result = await cmd.handler(args);
        return {
            error: false,
            message: result,
            command: cmdName,
            args
        };
    } catch (e) {
        const log = new Logger({ title: "Main" });
        log.error(`执行指令 "${cmdName}" 失败: ${e.message}`);
        return {
            error: true,
            message: `执行指令 "${cmdName}" 失败: ${e.message}`
        };
    }
}

export function initBackendCommands() {
    if (BACKEND_COMMANDS.has("help")) return;

    const log = new Logger({ title: "Backend" });

    registerBackendCommand("help", "显示所有后台指令", async (args) => {
        const log = new Logger({ title: "Main" });
        const lines = ["📋 可用的后台指令:", ""];
        for (const [name, cmd] of BACKEND_COMMANDS) {
            lines.push(`  ${name.padEnd(12)} - ${cmd.description}`);
        }
        lines.push("");
        lines.push("💡 输入指令名查看详细用法");
        for (const line of lines) {
            log.info(line);
        }
        return null;
    });

    registerBackendCommand("status", "显示系统状态", async (args) => {
        const log = new Logger({ title: "Main" });
        const lines = [
            "📊 系统状态",
            "",
            `  进程 ID: ${process.pid}`,
            `  运行时间: ${formatUptime(process.uptime() * 1000)}`,
            `  Node 版本: ${process.version}`,
            `  平台: ${process.platform} ${process.arch}`,
            `  内存使用: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB`,
        ];
        for (const line of lines) {
            log.info(line);
        }
        return null;
    });

    registerBackendCommand("reload", "重新加载配置文件", async (args) => {
        const log = new Logger({ title: "Main" });
        try {
            const fs = await import("node:fs");
            const configPath = process.env.QQBOT_CONFIG || "./config.json";
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                log.info(`✅ 配置已重新加载: ${configPath}`);
                return null;
            }
            log.error(`❌ 配置文件不存在: ${configPath}`);
            return null;
        } catch (e) {
            log.error(`❌ 重新加载失败: ${e.message}`);
            return null;
        }
    });

    registerBackendCommand("clear", "清空终端", async (args) => {
        console.clear();
        return null;
    });

    registerBackendCommand("exit", "退出程序", async (args) => {
        const log = new Logger({ title: "Main" });
        log.info("👋 正在退出...");
        setTimeout(() => process.exit(0), 200);
        return null;
    });

    log.debug(`已注册 ${BACKEND_COMMANDS.size} 个后台指令`);
}

function formatUptime(ms) {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}