import { QQGateway } from "./gateway.js";
import { MessageHandler, registerCommand, registerBuiltinCommands } from "./handler.js";
import { Config, logger } from "./utils.js";
import * as api from "./api.js";

/**
 * QQBot 客户端类
 */
export class QQBotClient {
    constructor(configPath) {
        this.config = new Config(configPath);
        this.cfg = this.config.load();
        this.gateway = null;
        this.handler = null;
        this.isRunning = false;
        this._eventHandlers = new Map();
        this._startTime = null;
    }

    /**
     * 初始化配置
     */
    configure(appId, clientSecret, options = {}) {
        this.cfg = {
            appId,
            clientSecret,
            ...options,
        };
        this.config.config = this.cfg;
        this.config.save();
        return this;
    }

    /**
     * 注册事件监听
     */
    on(event, handler) {
        if (!this._eventHandlers.has(event)) {
            this._eventHandlers.set(event, []);
        }
        this._eventHandlers.get(event).push(handler);

        if (this.gateway) {
            this.gateway.on(event, handler);
        }
        return this;
    }

    /**
     * 注册斜杠指令
     */
    command(name, description, handler) {
        registerCommand(name, description, handler);
        return this;
    }

    /**
     * 回复消息
     */
    async reply(msg, content, options = {}) {
        const { appId, clientSecret } = this.cfg;
        const isMarkdown = options.markdown || false;

        try {
            if (msg.type === "c2c") {
                if (isMarkdown) {
                    return api.sendMarkdownMessage(appId, clientSecret, msg.senderId, "c2c", content, msg.messageId);
                }
                return api.sendC2CMessage(appId, clientSecret, msg.senderId, content, msg.messageId);
            } else if (msg.type === "group") {
                if (isMarkdown) {
                    return api.sendMarkdownMessage(appId, clientSecret, msg.groupOpenid, "group", content, msg.messageId);
                }
                return api.sendGroupMessage(appId, clientSecret, msg.groupOpenid, content, msg.messageId);
            }
        } catch (e) {
            logger.error(`回复失败: ${e.message}`);
            throw e;
        }
    }

    /**
     * 加载插件
     * @param {string|Function|Object} plugin - 插件路径或注册函数
     */
    async loadPlugin(plugin) {
        let registerFn;

        if (typeof plugin === "string") {
            try {
                const module = await import(plugin);
                registerFn = module.register || module.default?.register;
                if (!registerFn) {
                    logger.error(`插件 ${plugin} 未导出 register 函数`);
                    return this;
                }
            } catch (e) {
                logger.error(`加载插件 ${plugin} 失败: ${e.message}`);
                return this;
            }
        } else if (typeof plugin === "function") {
            registerFn = plugin;
        } else if (plugin && typeof plugin.register === "function") {
            registerFn = plugin.register;
        } else {
            logger.error("插件必须提供 register 函数");
            return this;
        }

        if (registerFn) {
            try {
                registerFn(this);
                logger.info(`✅ 插件加载成功`);
            } catch (e) {
                logger.error(`插件注册失败: ${e.message}`);
            }
        }

        return this;
    }

    /**
     * 加载 plugins 目录下所有插件
     */
    async loadPlugins(dir = "./plugins") {
        const fs = await import("node:fs");
        const path = await import("node:path");

        const resolvedDir = path.resolve(process.cwd(), dir);

        if (!fs.existsSync(resolvedDir)) {
            logger.warn(`插件目录不存在: ${resolvedDir}`);
            return this;
        }

        const files = fs.readdirSync(resolvedDir).filter((f) => f.endsWith(".js"));

        if (files.length === 0) {
            logger.info(`插件目录为空: ${resolvedDir}`);
            return this;
        }

        logger.info(`发现 ${files.length} 个插件文件`);

        for (const file of files) {
            const pluginPath = path.join(resolvedDir, file);
            try {
                // 使用 file:// 协议导入
                const url = `file://${pluginPath}`;
                await this.loadPlugin(url);
            } catch (e) {
                logger.error(`加载插件 ${file} 失败: ${e.message}`);
            }
        }

        return this;
    }

    /**
     * 启动
     */
    async start() {
        if (this.isRunning) {
            logger.warn("客户端已运行");
            return this;
        }

        if (!this.cfg?.appId || !this.cfg?.clientSecret) {
            throw new Error("缺少 appId 或 clientSecret，请先调用 configure()");
        }

        logger.info("QQBot 启动中...");

        registerBuiltinCommands();

        this.gateway = new QQGateway(this.cfg);

        for (const [event, handlers] of this._eventHandlers) {
            for (const handler of handlers) {
                this.gateway.on(event, handler);
            }
        }

        this.handler = new MessageHandler(this.gateway, this.cfg);

        await this.gateway.start();
        this.handler.start();

        this.isRunning = true;
        this._startTime = Date.now();

        logger.info("QQBot 已启动");
        return this;
    }

    /**
     * 停止
     */
    stop() {
        if (this.gateway) {
            this.gateway.stop();
        }
        this.isRunning = false;
        logger.info("QQBot 已停止");
        return this;
    }

    /**
     * 发送消息
     */
    send(targetType, targetId, content, msgId) {
        if (!this.gateway) {
            throw new Error("客户端未启动");
        }
        return this.gateway.sendMessage(targetType, targetId, content, msgId);
    }

    /**
     * 发送私聊
     */
    sendC2C(openid, content, msgId) {
        return this.send("c2c", openid, content, msgId);
    }

    /**
     * 发送群聊
     */
    sendGroup(groupOpenid, content, msgId) {
        return this.send("group", groupOpenid, content, msgId);
    }

    /**
     * 发送图片
     */
    sendImage(targetType, targetId, imageUrl, msgId, text) {
        return api.sendImageMessage(
            this.cfg.appId,
            this.cfg.clientSecret,
            targetId,
            targetType,
            imageUrl,
            msgId,
            text
        );
    }

    /**
     * 获取 API 工具
     */
    get api() {
        return {
            ...api,
            appId: this.cfg?.appId,
            clientSecret: this.cfg?.clientSecret,
        };
    }
    
    /**
     * 回复消息 (委托给 handler)
     */
    async reply(msg, content, options = {}) {
        if (!this.handler) {
            throw new Error("消息处理器未初始化");
        }
        return this.handler.reply(msg, content, options);
    }
}

/**
 * 创建客户端实例
 */
export function createClient(configPath) {
    return new QQBotClient(configPath);
}

export * from "./api.js";
export { logger, Config } from "./utils.js";
export { QQGateway } from "./gateway.js";
export { MessageHandler, registerCommand } from "./handler.js";