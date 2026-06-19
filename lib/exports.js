/**
 * QQBot 框架核心模块
 * 提供简洁的 API：logger, addCmd, listen, send, reply
 */

import { QQGateway } from "./gateway.js";
import { MessageHandler, SLASH_COMMANDS } from "./handler.js";
import { Config, createLogger, registerBackendCommand, getBackendCommands } from "./utils.js";
import * as api from "./api.js";

// ============ 插件加载器 ============

/**
 * 插件上下文
 */
class PluginContext {
    constructor(bot, pluginName) {
        this.bot = bot;
        this.name = pluginName;
        // 自动创建 logger
        this.logger = createLogger(pluginName);
    }

    // 注册斜杠指令
    cmd(name, desc, handler) {
        this.bot.command(name, desc, handler);
        return this;
    }

    // 注册后台命令
    addCmd(name, desc, handler) {
        registerBackendCommand(name, desc, handler);
        return this;
    }

    // 监听事件
    listen(event, handler) {
        this.bot.on(event, handler);
        return this;
    }

    // 发送消息
    send(target, content, mode = "text") {
        return this.bot.send(target, content, mode);
    }

    // 回复消息
    reply(msg, content, options = {}) {
        return this.bot.reply(msg, content, options);
    }

    // 发送私聊
    sendC2C(openid, content) {
        return this.bot.sendC2C(openid, content);
    }

    // 发送群聊
    sendGroup(groupOpenid, content) {
        return this.bot.sendGroup(groupOpenid, content);
    }

    // 发送图片
    sendImage(type, target, url, msgId, text) {
        return this.bot.sendImage(type, target, url, msgId, text);
    }

    // 获取配置
    get config() {
        return this.bot.cfg;
    }

    // 获取网关
    get gateway() {
        return this.bot.gateway;
    }
}

/**
 * QQBot 客户端
 */
export class QQBot {
    constructor(configPath) {
        this.config = new Config(configPath);
        this.cfg = this.config.load() || {};
        this.gateway = null;
        this.handler = null;
        this.isRunning = false;
        this._events = new Map();
        this._startTime = null;
        this._plugins = [];
    }

    // ============ 核心 API ============

    // 配置
    setup(appId, clientSecret, opts = {}) {
        this.cfg = { appId, clientSecret, ...opts };
        this.config.config = this.cfg;
        this.config.save();
        return this;
    }

    // 注册斜杠指令 (内部使用)
    command(name, desc, handler) {
        const key = name.toLowerCase();
        SLASH_COMMANDS.set(key, { description: desc, handler });
        return this;
    }

    // 注册事件 (内部使用)
    on(event, handler) {
        if (!this._events.has(event)) {
            this._events.set(event, []);
        }
        this._events.get(event).push(handler);
        if (this.gateway) {
            this.gateway.on(event, handler);
        }
        return this;
    }

    // 加载插件
    async load(name, pluginFn) {
        const ctx = new PluginContext(this, name);
        try {
            if (typeof pluginFn === "function") {
                pluginFn(ctx);
            } else if (typeof pluginFn === "object" && pluginFn.register) {
                pluginFn.register(ctx);
            } else {
                throw new Error("插件必须提供 register 函数或函数本身");
            }
            this._plugins.push(name);
            ctx.logger.info(`✅ 已加载`);
        } catch (e) {
            ctx.logger.error(`❌ 加载失败: ${e.message}`);
        }
        return this;
    }

    // 加载 plugins 目录
    async loadDir(dir = "./plugins") {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const resolved = path.resolve(process.cwd(), dir);

        if (!fs.existsSync(resolved)) {
            const log = createLogger("Loader");
            log.warn(`插件目录不存在: ${resolved}`);
            return this;
        }

        const files = fs.readdirSync(resolved).filter(f => f.endsWith(".js"));
        if (files.length === 0) {
            const log = createLogger("Loader");
            log.info(`插件目录为空: ${resolved}`);
            return this;
        }

        const log = createLogger("Loader");
        log.info(`发现 ${files.length} 个插件`);

        for (const file of files) {
            const name = file.replace(/\.js$/, "");
            const url = `file://${path.join(resolved, file)}`;
            try {
                const mod = await import(url);
                const fn = mod.register || mod.default?.register;
                if (fn) {
                    await this.load(name, fn);
                } else {
                    const ctx = new PluginContext(this, name);
                    ctx.logger.error("未导出 register 函数");
                }
            } catch (e) {
                const ctx = new PluginContext(this, name);
                ctx.logger.error(`加载失败: ${e.message}`);
            }
        }
        return this;
    }

    // 启动
    async start() {
        if (this.isRunning) {
            const log = createLogger("QQBot");
            log.warn("已运行中");
            return this;
        }

        if (!this.cfg?.appId || !this.cfg?.clientSecret) {
            throw new Error("缺少 appId 或 clientSecret，请先调用 setup()");
        }

        const log = createLogger("QQBot");
        log.info("启动中...");

        // 注册内置指令
        this._registerBuiltin();

        // 创建网关
        this.gateway = new QQGateway(this.cfg);
        for (const [event, handlers] of this._events) {
            for (const h of handlers) {
                this.gateway.on(event, h);
            }
        }

        // 创建消息处理器
        this.handler = new MessageHandler(this.gateway, this.cfg);

        // 启动
        await this.gateway.start();
        this.handler.start();

        this.isRunning = true;
        this._startTime = Date.now();

        const cmds = Array.from(SLASH_COMMANDS.keys());
        log.info(`📋 指令: ${cmds.join(", ") || "无"}`);
        log.info("✅ 已启动");

        return this;
    }

    // 停止
    stop() {
        if (this.gateway) this.gateway.stop();
        if (this.handler) this.handler.stop();
        this.isRunning = false;
        const log = createLogger("QQBot");
        log.info("已停止");
        return this;
    }

    // ============ 发送消息 ============

    // 通用发送
    send(target, content, mode = "text") {
        if (!this.gateway) throw new Error("未启动");
        return this.gateway.sendMessage(target, content, mode);
    }

    // 私聊
    sendC2C(openid, content) {
        return this.send("c2c", openid, content);
    }

    // 群聊
    sendGroup(groupOpenid, content) {
        return this.send("group", groupOpenid, content);
    }

    // 图片
    sendImage(type, target, url, msgId, text) {
        return api.sendImageMessage(
            this.cfg.appId, this.cfg.clientSecret,
            target, type, url, msgId, text
        );
    }

    // 回复
    reply(msg, content, opts = {}) {
        if (!this.handler) throw new Error("消息处理器未初始化");
        return this.handler.reply(msg, content, opts);
    }

    // ============ 内部方法 ============

    _registerBuiltin() {
        if (SLASH_COMMANDS.has("help")) return;

        this.command("help", "显示帮助", async () => {
            const lines = ["### 可用指令", ""];
            for (const [name, cmd] of SLASH_COMMANDS) {
                lines.push(`**/${name}** — ${cmd.description}`);
            }
            return lines.join("\n");
        });

        this.command("ping", "测试延迟", async (msg) => {
            const now = Date.now();
            const t = new Date(msg.timestamp).getTime();
            return `🏓 pong! ${now - t}ms`;
        });

        this.command("status", "查看状态", async () => {
            const uptime = this._startTime ? Date.now() - this._startTime : 0;
            return [
                `🤖 状态: ${this.isRunning ? "✅ 运行中" : "❌ 已停止"}`,
                `🔗 会话: ${this.gateway?.sessionId || "未连接"}`,
                `⏰ 运行: ${this._formatTime(uptime)}`,
            ].join("\n");
        });
    }

    _formatTime(ms) {
        if (ms < 1000) return `${ms}ms`;
        const s = Math.floor(ms / 1000);
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        const r = s % 60;
        if (m < 60) return `${m}m ${r}s`;
        const h = Math.floor(m / 60);
        return `${h}h ${m % 60}m ${r}s`;
    }
}

// ============ 工厂函数 ============

export function createBot(configPath) {
    return new QQBot(configPath);
}

// 导出常用功能
export { api, createLogger, registerBackendCommand, getBackendCommands };