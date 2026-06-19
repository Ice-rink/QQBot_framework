/**
 * QQBot 客户端主类
 * 包含 PluginContext，所有方法已绑定 this
 */

import { QQGateway } from "./gateway.js";
import { MessageHandler, SLASH_COMMANDS } from "./handler.js";
import { Config, createLogger, addCmd, getBackendCommands } from "./utils.js";
import * as api from "./api.js";

/**
 * 插件上下文 (关键：所有方法绑定 this)
 */
class PluginContext {
    constructor(bot, pluginName) {
        this.bot = bot;
        this.name = pluginName;
        this.logger = createLogger(pluginName);

        // 绑定所有方法，确保解构后 this 正确
        this.cmd = this.cmd.bind(this);
        this.addCmd = this.addCmd.bind(this);
        this.on = this.on.bind(this);
        this.send = this.send.bind(this);
        this.reply = this.reply.bind(this);
        this.sendC2C = this.sendC2C.bind(this);
        this.sendGroup = this.sendGroup.bind(this);
        this.sendImage = this.sendImage.bind(this);
    }

    cmd(name, desc, handler) {
        this.bot.command(name, desc, handler);
        return this;
    }

    addCmd(name, desc, handler) {
        // 直接调用全局 addCmd（从 utils 导入）
        addCmd(name, desc, handler);
        return this;
    }

    on(event, handler) {
        this.bot.on(event, handler);
        return this;
    }

    send(target, content, mode = "text") {
        return this.bot.send(target, content, mode);
    }

    reply(msg, content, options = {}) {
        return this.bot.reply(msg, content, options);
    }

    sendC2C(openid, content) {
        return this.bot.sendC2C(openid, content);
    }

    sendGroup(groupOpenid, content) {
        return this.bot.sendGroup(groupOpenid, content);
    }

    sendImage(type, target, url, msgId, text) {
        return this.bot.sendImage(type, target, url, msgId, text);
    }

    get config() {
        return this.bot.cfg;
    }

    get gateway() {
        return this.bot.gateway;
    }
}

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

    // ---------- 配置 ----------
    setup(appId, clientSecret, opts = {}) {
        this.cfg = { appId, clientSecret, ...opts };
        this.config.config = this.cfg;
        this.config.save();
        return this;
    }

    // ---------- 事件 ----------
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

    // ---------- 指令 ----------
    command(name, desc, handler) {
        const key = name.toLowerCase();
        SLASH_COMMANDS.set(key, { description: desc, handler });
        return this;
    }

    // ---------- 插件加载 ----------
    async load(name, pluginFn) {
        const ctx = new PluginContext(this, name);
        try {
            if (typeof pluginFn === "function") {
                await pluginFn(ctx);
            } else if (typeof pluginFn === "object" && pluginFn.register) {
                await pluginFn.register(ctx);
            } else {
                throw new Error("插件必须提供 register 函数或函数本身");
            }
            this._plugins.push(name);
            ctx.logger.info(`✅ 已加载`);
        } catch (e) {
            ctx.logger.error(`❌ 加载失败: ${e.message}\n${e.stack}`);
        }
        return this;
    }

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
                if (typeof mod.default === "function") {
                    const ctx = new PluginContext(this, name);
                    await mod.default(ctx);
                } else if (mod.register) {
                    const ctx = new PluginContext(this, name);
                    await mod.register(ctx);
                } else {
                    const ctx = new PluginContext(this, name);
                    ctx.logger.warn("未导出 default 或 register 函数，跳过");
                }
            } catch (e) {
                const ctx = new PluginContext(this, name);
                ctx.logger.error(`加载失败: ${e.message}\n${e.stack}`);
            }
        }
        return this;
    }

    // ---------- 启动/停止 ----------
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

        this._registerBuiltin();

        this.gateway = new QQGateway(this.cfg);
        for (const [event, handlers] of this._events) {
            for (const h of handlers) {
                this.gateway.on(event, h);
            }
        }

        this.handler = new MessageHandler(this.gateway, this.cfg);

        await this.gateway.start();
        this.handler.start();

        this.isRunning = true;
        this._startTime = Date.now();

        const cmds = Array.from(SLASH_COMMANDS.keys());
        log.info(`📋 指令: ${cmds.join(", ") || "无"}`);
        log.info("✅ 已启动");

        return this;
    }

    stop() {
        if (this.gateway) this.gateway.stop();
        if (this.handler) this.handler.stop();
        this.isRunning = false;
        const log = createLogger("QQBot");
        log.info("已停止");
        return this;
    }

    // ---------- 发送 ----------
    send(target, content, mode = "text") {
        if (!this.gateway) throw new Error("未启动");
        return this.gateway.sendMessage(target, content, mode);
    }

    sendC2C(openid, content) {
        return this.send("c2c", openid, content);
    }

    sendGroup(groupOpenid, content) {
        return this.send("group", groupOpenid, content);
    }

    sendImage(type, target, url, msgId, text) {
        return api.sendImageMessage(
            this.cfg.appId, this.cfg.clientSecret,
            target, type, url, msgId, text
        );
    }

    reply(msg, content, opts = {}) {
        if (!this.handler) throw new Error("消息处理器未初始化");
        return this.handler.reply(msg, content, opts);
    }

    // ---------- 内置指令 ----------
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