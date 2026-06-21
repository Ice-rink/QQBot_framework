/**
 * QQBot 主模块
 * 
 * 导出所有 API，插件通过 import * as QQBot from "../lib/QQBot.js" 使用
 * 所有 API 自动绑定当前插件上下文 (AsyncLocalStorage)
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { QQGateway } from './gateway.js';
import { MessageHandler, SLASH_COMMANDS } from './handler.js';
import { Config, createLogger, addCmd, getBackendCommands, executeBackendCommand, initBackendCommands } from './utils.js';
import * as api from './api.js';

// ============ 插件上下文存储 ============
const pluginContexts = new AsyncLocalStorage();

function getContext() {
    const ctx = pluginContexts.getStore();
    if (!ctx) {
        throw new Error('QQBot API 只能在插件上下文中调用');
    }
    return ctx;
}

// ============ QQBot 主类 ============
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
        this._pluginContexts = [];
    }

    setup(appId, clientSecret, opts = {}) {
        this.cfg = { appId, clientSecret, ...opts };
        this.config.config = this.cfg;
        this.config.save();
        return this;
    }

    on(event, handler) {
        if (!this._events.has(event)) {
            this._events.set(event, []);
        }
        const list = this._events.get(event);
        if (!list.includes(handler)) {
            list.push(handler);
        }
        if (this.gateway) {
            this.gateway.on(event, handler);
        }
        return this;
    }

    command(name, desc, handler) {
        SLASH_COMMANDS.set(name.toLowerCase(), { description: desc, handler });
        return this;
    }

    async loadDir(dir = './plugins') {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const resolved = path.resolve(process.cwd(), dir);

        if (!fs.existsSync(resolved)) {
            createLogger('Loader').warn(`插件目录不存在: ${resolved}`);
            return this;
        }

        const files = fs.readdirSync(resolved).filter(f => f.endsWith('.js'));
        if (files.length === 0) {
            createLogger('Loader').info(`插件目录为空: ${resolved}`);
            return this;
        }

        const log = createLogger('Loader');
        log.info(`发现 ${files.length} 个插件`);

        for (const file of files) {
            const name = file.replace(/\.js$/, '');
            const url = `file://${path.join(resolved, file)}`;
            await this._loadPlugin(name, url);
        }
        return this;
    }

    async _loadPlugin(name, url) {
        const ctx = this._createContext(name);
        try {
            await pluginContexts.run(ctx, async () => {
                await import(url);
            });
            this._pluginContexts.push(ctx);
            this._plugins.push(name);
            ctx.logger.info(`✅ 已加载 (${ctx.meta.version})`);
        } catch (e) {
            ctx.logger.error(`❌ 加载失败: ${e.message}`);
            if (e.stack) ctx.logger.error(e.stack);
        }
    }

    _createContext(name) {
        return {
            name,
            logger: createLogger(name),
            meta: { name, version: '0.0.0', description: name },
            _events: [],
            bot: this,
        };
    }

    async start() {
        if (this.isRunning) {
            createLogger('QQBot').warn('已运行中');
            return this;
        }

        if (!this.cfg?.appId || !this.cfg?.clientSecret) {
            throw new Error('缺少 appId 或 clientSecret，请先调用 setup()');
        }

        const log = createLogger('QQBot');
        log.info('启动中...');

        this._registerBuiltin();
        initBackendCommands();

        this.gateway = new QQGateway(this.cfg);

        for (const [event, handlers] of this._events) {
            for (const h of handlers) {
                this.gateway.on(event, h);
            }
        }

        for (const ctx of this._pluginContexts) {
            for (const ev of ctx._events) {
                this.gateway.on(ev.event, ev.handler);
            }
        }

        this.handler = new MessageHandler(this.gateway, this.cfg);

        await this.gateway.start();
        this.handler.start();

        this.isRunning = true;
        this._startTime = Date.now();

        const cmds = Array.from(SLASH_COMMANDS.keys());
        log.info(`📋 指令: ${cmds.join(', ') || '无'}`);
        log.info(`📋 插件: ${this._plugins.join(', ') || '无'}`);
        log.info('✅ 已启动');

        return this;
    }

    stop() {
        if (this.gateway) this.gateway.stop();
        if (this.handler) this.handler.stop();
        this.isRunning = false;
        createLogger('QQBot').info('已停止');
        return this;
    }

    send(target, content, mode = 'text') {
        if (!this.gateway) throw new Error('未启动');
        return this.gateway.sendMessage(target, content, mode);
    }

    sendC2C(openid, content) {
        return this.send('c2c', openid, content);
    }

    sendGroup(groupOpenid, content) {
        return this.send('group', groupOpenid, content);
    }

    sendImage(type, target, url, msgId, text) {
        return api.sendImageMessage(
            this.cfg.appId, this.cfg.clientSecret,
            target, type, url, msgId, text
        );
    }

    reply(msg, content, opts = {}) {
        if (!this.handler) throw new Error('消息处理器未初始化');
        return this.handler.reply(msg, content, opts);
    }

    get status() {
        return {
            running: this.isRunning,
            session: this.gateway?.sessionId || null,
            uptime: this._startTime ? Date.now() - this._startTime : 0,
            plugins: this._plugins,
        };
    }

    _registerBuiltin() {
        if (SLASH_COMMANDS.has('help')) return;

        this.command('help', '显示帮助', async () => {
            const lines = ['### 可用指令', ''];
            for (const [name, cmd] of SLASH_COMMANDS) {
                lines.push(`**/${name}** — ${cmd.description}`);
            }
            return lines.join('\n');
        });

        this.command('ping', '测试延迟', async (msg) => {
            const now = Date.now();
            const t = new Date(msg.timestamp).getTime();
            return `🏓 pong! ${now - t}ms`;
        });

        this.command('status', '查看状态', async () => {
            const s = this.status;
            return [
                `🤖 状态: ${s.running ? '✅ 运行中' : '❌ 已停止'}`,
                `🔗 会话: ${s.session || '未连接'}`,
                `⏰ 运行: ${this._formatTime(s.uptime)}`,
                `📋 插件: ${s.plugins.join(', ') || '无'}`,
            ].join('\n');
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

// ============ 插件 API 代理 ============
// 所有 API 函数自动绑定当前插件上下文

const contextApis = {
    metaData(ctx, meta) {
        Object.assign(ctx.meta, meta);
    },

    on(ctx, event, handler) {
        const wrapped = (msg) => {
            const reply = (arg1, arg2, arg3) => {
                let content, opts = {};
                // 如果第一个参数是消息对象（拥有 type 或 messageId），忽略它
                if (arg1 && typeof arg1 === 'object' && (arg1.type || arg1.messageId)) {
                    content = arg2;
                    opts = arg3 || {};
                } else {
                    content = arg1;
                    opts = arg2 || {};
                }
                return ctx.bot.reply(msg, content, opts);
            };
            return handler(msg, reply);
        };
        ctx._events.push({ event, handler: wrapped });
        if (ctx.bot.gateway) {
            ctx.bot.gateway.on(event, wrapped);
        }
    },

    cmd(ctx, name, desc, handler) {
        ctx.bot.command(name, desc, handler);
    },

    addCmd(ctx, name, desc, handler) {
        addCmd(name, desc, handler);
    },

    send(ctx, target, content, mode = 'text') {
        return ctx.bot.send(target, content, mode);
    },

    sendC2C(ctx, openid, content) {
        return ctx.bot.sendC2C(openid, content);
    },

    sendGroup(ctx, groupOpenid, content) {
        return ctx.bot.sendGroup(groupOpenid, content);
    },

    sendImage(ctx, type, target, url, msgId, text) {
        return ctx.bot.sendImage(type, target, url, msgId, text);
    },

    reply(ctx, msg, content, opts = {}) {
        return ctx.bot.reply(msg, content, opts);
    },

    getConfig(ctx) {
        return ctx.bot.cfg;
    },

    getStatus(ctx) {
        return ctx.bot.status;
    },

    createLogger(ctx, title) {
        return createLogger(title);
    }
};

export { QQBot as QQBotClass };

// 创建代理对象
const QQBotAPI = new Proxy({}, {
    get(target, prop) {
        // 上下文 API
        if (prop in contextApis) {
            const impl = contextApis[prop];
            if (typeof impl === 'function') {
                return (...args) => {
                    const ctx = getContext();
                    return impl(ctx, ...args);
                };
            }
        }

        // api 模块
        if (prop in api) {
            return api[prop];
        }

        // 工具函数（命名导出，不通过代理）
        // 这里不再返回

        // 暴露 QQBot 类
        if (prop === 'QQBot') {
            return QQBot;
        }

        return undefined;
    }
});

// 默认导出代理对象
export default QQBotAPI;

// 命名导出工具函数（无需上下文）
export { createLogger, addCmd, getBackendCommands, executeBackendCommand, initBackendCommands };