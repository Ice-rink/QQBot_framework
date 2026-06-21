import { logger } from "./utils.js";
import { sendC2CMessage, sendGroupMessage, sendMarkdownMessage, sendInputNotify } from "./api.js";

/**
 * 内置斜杠指令 - 导出供外部访问
 */
export const SLASH_COMMANDS = new Map();

/**
 * 注册斜杠指令
 */
export function registerCommand(name, description, handler) {
    const key = name.toLowerCase();
    SLASH_COMMANDS.set(key, { description, handler });
    logger.debug(`注册指令: /${name}`);
    return true;
}

/**
 * 获取所有已注册指令
 */
export function getRegisteredCommands() {
    return Array.from(SLASH_COMMANDS.keys());
}

/**
 * 消息处理器
 */
export class MessageHandler {
    constructor(gateway, config) {
        this.gateway = gateway;
        this.config = config;
        this.messageQueue = [];
        this.processing = false;
        this.isRunning = false;
    }

    /**
     * 启动消息处理
     */
    start() {
        this.isRunning = true;
        this.gateway.on("message", (msg) => {
            this.enqueue(msg);
        });
        this.processLoop();
        logger.info("消息处理器已启动");
    }

    /**
     * 停止消息处理
     */
    stop() {
        this.isRunning = false;
    }

    /**
     * 消息入队
     */
    enqueue(msg) {
        this.messageQueue.push(msg);
    }

    /**
     * 处理循环
     */
    async processLoop() {
        while (this.isRunning) {
            if (this.messageQueue.length > 0 && !this.processing) {
                const msg = this.messageQueue.shift();
                await this.processMessage(msg);
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    /**
     * 处理单条消息
     */
    async processMessage(msg) {
        this.processing = true;
        try {
            const { appId, clientSecret } = this.config;

            // 发送 "正在输入" 状态 (仅私聊)
            if (msg.type === "c2c" && msg.openid) {
                sendInputNotify(appId, clientSecret, msg.openid, msg.messageId).catch(() => { });
            }

            // 检查斜杠指令
            if (msg.content?.startsWith("/")) {
                const handled = await this.handleSlashCommand(msg);
                if (handled) return;
            }

            // 检查普通命令 (不含 /)
            if (msg.content?.trim() === "test") {
                const timestamp = Date.now();
                const reply = `⏰ 当前时间戳: ${timestamp}`;
                await this.reply(msg, reply);
                return;
            }

            // 触发消息事件 (供外部处理)
            this.gateway.emit("message_received", msg);

        } catch (e) {
            logger.error(`处理消息失败: ${e.message}`);
        } finally {
            this.processing = false;
        }
    }

    /**
     * 处理斜杠指令
     */
    async handleSlashCommand(msg) {
        const parts = msg.content.slice(1).split(/\s+/);
        const cmdName = parts[0].toLowerCase();
        const args = parts.slice(1).join(" ");

        const cmd = SLASH_COMMANDS.get(cmdName);
        if (!cmd) return false;

        logger.info(`执行指令: /${cmdName} (from ${msg.senderId || msg.openid})`);

        try {
            const result = await cmd.handler(msg, args);
            if (result) {
                await this.reply(msg, result);
            }
        } catch (e) {
            logger.error(`指令执行失败: ${e.message}`);
            await this.reply(msg, `❌ 指令执行失败: ${e.message}`);
        }

        return true;
    }

    /**
     * 回复消息
     */
    async reply(msg, content, options = {}) {
        const { appId, clientSecret } = this.config;
        const isMarkdown = options.markdown || false;

        try {
            // 私聊
            if (msg.type === "c2c") {
                const openid = msg.openid || msg.senderId;
                if (!openid) {
                    logger.error("无法获取私聊 openid");
                    return;
                }
                if (isMarkdown) {
                    return sendMarkdownMessage(appId, clientSecret, openid, "c2c", content, msg.messageId);
                }
                return sendC2CMessage(appId, clientSecret, openid, content, msg.messageId);
            }

            // 群聊
            if (msg.type === "group") {
                const groupOpenid = msg.groupOpenid;
                if (!groupOpenid) {
                    logger.error("无法获取群聊 groupOpenid");
                    return;
                }
                if (isMarkdown) {
                    return sendMarkdownMessage(appId, clientSecret, groupOpenid, "group", content, msg.messageId);
                }
                return sendGroupMessage(appId, clientSecret, groupOpenid, content, msg.messageId);
            }

            // 频道
            if (msg.type === "channel") {
                const channelId = msg.channelId;
                if (!channelId) {
                    logger.error("无法获取频道 channelId");
                    return;
                }
                const { sendChannelMessage } = await import("./api.js");
                return sendChannelMessage(appId, clientSecret, channelId, content, msg.messageId);
            }

            logger.error(`不支持的消息类型: ${msg.type}`);
        } catch (e) {
            logger.error(`回复失败: ${e.message}`);
            throw e;
        }
    }
}

/**
 * 注册内置指令
 */
export function registerBuiltinCommands() {
    // 检查是否已注册，避免重复
    if (SLASH_COMMANDS.has("ping")) return;

    registerCommand("ping", "测试延迟", async (msg) => {
        const now = Date.now();
        const msgTime = new Date(msg.timestamp).getTime();
        const delay = now - msgTime;
        return `✅ pong！⏱ 延迟: ${delay}ms`;
    });

    registerCommand("help", "查看帮助", async () => {
        const lines = ["### QQBot 指令列表", ""];
        for (const [name, cmd] of SLASH_COMMANDS) {
            lines.push(`**/${name}** — ${cmd.description}`);
        }
        return lines.join("\n");
    });

    registerCommand("status", "查看状态", async (msg) => {
        const lines = [
            "### QQBot 状态",
            "",
            `会话 ID: ${this?.gateway?.sessionId || "未连接"}`,
            `消息序号: ${this?.gateway?.lastSeq || "N/A"}`,
        ];
        return lines.join("\n");
    });
}