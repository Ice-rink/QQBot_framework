import WebSocket from "ws";
import https from "https";
import { logger, sleep, getNextMsgSeq } from "./utils.js";
import { getAccessToken, clearTokenCache } from "./api.js";
import { sendC2CMessage, sendGroupMessage, sendChannelMessage } from "./api.js";

const INTENTS = {
    GUILDS: 1 << 0,
    GUILD_MEMBERS: 1 << 1,
    PUBLIC_GUILD_MESSAGES: 1 << 30,
    DIRECT_MESSAGE: 1 << 12,
    GROUP_AND_C2C: 1 << 25,
    INTERACTION: 1 << 26,
};

const FULL_INTENTS = INTENTS.PUBLIC_GUILD_MESSAGES | INTENTS.DIRECT_MESSAGE |
    INTENTS.GROUP_AND_C2C | INTENTS.INTERACTION;

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000];

/**
 * 使用 https 模块发起请求
 */
function httpsRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json, raw: data });
                } catch (err) {
                    reject(new Error(`解析响应失败: ${err.message}, raw: ${data.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

export class QQGateway {
    constructor(config) {
        this.config = config;
        this.ws = null;
        this.sessionId = null;
        this.lastSeq = null;
        this.heartbeatInterval = null;
        this.reconnectAttempts = 0;
        this.isRunning = false;
        this.eventHandlers = new Map();
        this.messageQueue = [];
    }

    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }

    emit(event, data) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(data);
                } catch (e) {
                    logger.error(`事件处理错误 (${event}): ${e.message}`);
                }
            }
        }
    }

    async start() {
        this.isRunning = true;
        await this.connect();
    }

    stop() {
        this.isRunning = false;
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    async connect() {
        if (!this.isRunning) return;

        try {
            const { appId, clientSecret } = this.config;
            const token = await getAccessToken(appId, clientSecret);

            // 获取网关地址 - 使用 https 模块
            logger.info('获取网关地址...');
            const gatewayResult = await httpsRequest({
                hostname: 'api.sgroup.qq.com',
                path: '/gateway',
                method: 'GET',
                headers: {
                    'Authorization': `QQBot ${token}`,
                    'User-Agent': 'QQBot-Framework/1.0',
                },
            });

            if (gatewayResult.status !== 200) {
                throw new Error(`获取网关地址失败: HTTP ${gatewayResult.status} - ${gatewayResult.raw}`);
            }

            const gatewayData = gatewayResult.data;
            logger.debug(`网关响应: ${JSON.stringify(gatewayData)}`);

            const url = gatewayData.url;
            if (!url) {
                throw new Error(`网关响应缺少 url 字段: ${JSON.stringify(gatewayData)}`);
            }

            logger.info(`连接网关: ${url}`);
            this.ws = new WebSocket(url);

            this.ws.on("open", () => {
                logger.info("WebSocket 已连接");
                this.reconnectAttempts = 0;

                if (this.sessionId && this.lastSeq !== null) {
                    this.ws.send(JSON.stringify({
                        op: 6,
                        d: {
                            token: `QQBot ${token}`,
                            session_id: this.sessionId,
                            seq: this.lastSeq,
                        },
                    }));
                    logger.info("尝试恢复会话");
                } else {
                    this.ws.send(JSON.stringify({
                        op: 2,
                        d: {
                            token: `QQBot ${token}`,
                            intents: FULL_INTENTS,
                            shard: [0, 1],
                        },
                    }));
                    logger.info("发送 Identify");
                }
            });

            this.ws.on("message", (data) => {
                this.handleMessage(data);
            });

            this.ws.on("close", (code, reason) => {
                logger.warn(`WebSocket 断开: ${code} ${reason}`);
                if (code !== 1000) {
                    this.scheduleReconnect();
                }
            });

            this.ws.on("error", (err) => {
                logger.error(`WebSocket 错误: ${err.message}`);
            });

        } catch (err) {
            logger.error(`连接失败: ${err.message}`);
            this.scheduleReconnect();
        }
    }

    handleMessage(rawData) {
        try {
            const payload = JSON.parse(rawData.toString());
            const { op, d, s, t } = payload;

            if (s) {
                this.lastSeq = s;
            }

            switch (op) {
                case 0:
                    this.handleDispatch(t, d);
                    break;

                case 10:
                    const interval = d.heartbeat_interval;
                    this.startHeartbeat(interval);
                    break;

                case 11:
                    logger.debug("心跳 ACK");
                    break;

                case 7:
                    logger.info("服务端要求重连");
                    this.ws.close();
                    break;

                case 9:
                    const canResume = d;
                    if (!canResume) {
                        this.sessionId = null;
                        this.lastSeq = null;
                        clearTokenCache(this.config.appId);
                    }
                    this.ws.close();
                    break;

                default:
                    logger.debug(`未处理 OP: ${op}`);
            }
        } catch (e) {
            logger.error(`解析消息失败: ${e.message}`);
        }
    }

    handleDispatch(eventType, data) {
        logger.debug(`收到事件: ${eventType}`);

        if (eventType === "READY") {
            this.sessionId = data.session_id;
            logger.debug(`会话就绪: ${this.sessionId}`);
            this.emit("ready", data);
            return;
        }

        if (eventType === "RESUMED") {
            logger.debug("会话恢复成功");
            this.emit("resumed", data);
            return;
        }

        const messageEvents = [
            "C2C_MESSAGE_CREATE",
            "GROUP_AT_MESSAGE_CREATE",
            "GROUP_MESSAGE_CREATE",
            "AT_MESSAGE_CREATE",
            "DIRECT_MESSAGE_CREATE",
        ];

        if (messageEvents.includes(eventType)) {
            this.handleMessageEvent(eventType, data);
        }

        if (eventType === "INTERACTION_CREATE") {
            this.emit("interaction", data);
        }

        if (eventType === "GROUP_ADD_ROBOT") {
            this.emit("group_add", data);
        }
        if (eventType === "GROUP_DEL_ROBOT") {
            this.emit("group_del", data);
        }
    }

    handleMessageEvent(eventType, data) {
        let msg = {
            type: "unknown",
            senderId: null,
            content: null,
            messageId: null,
            timestamp: null,
        };

        if (eventType === "C2C_MESSAGE_CREATE") {
            msg.type = "c2c";
            msg.senderId = data.author.user_openid;
            msg.content = data.content;
            msg.messageId = data.id;
            msg.timestamp = data.timestamp;
            msg.openid = data.author.user_openid;
        } else if (eventType === "GROUP_AT_MESSAGE_CREATE" || eventType === "GROUP_MESSAGE_CREATE") {
            msg.type = "group";
            msg.senderId = data.author.member_openid;
            msg.content = data.content;
            msg.messageId = data.id;
            msg.timestamp = data.timestamp;
            msg.groupOpenid = data.group_openid;
            msg.mentions = data.mentions || [];
        } else if (eventType === "AT_MESSAGE_CREATE" || eventType === "DIRECT_MESSAGE_CREATE") {
            msg.type = "channel";
            msg.senderId = data.author.id;
            msg.content = data.content;
            msg.messageId = data.id;
            msg.timestamp = data.timestamp;
            msg.channelId = data.channel_id;
            msg.guildId = data.guild_id;
        }

        if (data.message_scene?.ext) {
            for (const ext of data.message_scene.ext) {
                if (ext.startsWith("ref_msg_idx=")) {
                    msg.refMsgIdx = ext.slice("ref_msg_idx=".length);
                }
                if (ext.startsWith("msg_idx=")) {
                    msg.msgIdx = ext.slice("msg_idx=".length);
                }
            }
        }

        this.emit("message", msg);
    }

    startHeartbeat(interval) {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ op: 1, d: this.lastSeq }));
            }
        }, interval);
        logger.debug(`心跳已启动 (${interval}ms)`);
    }

    scheduleReconnect() {
        if (!this.isRunning) return;

        const idx = Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1);
        const delay = RECONNECT_DELAYS[idx];
        this.reconnectAttempts++;

        logger.info(`${delay}ms 后重连 (尝试 ${this.reconnectAttempts})`);
        setTimeout(() => this.connect(), delay);
    }

    async sendMessage(targetType, targetId, content, msgId) {
        const { appId, clientSecret } = this.config;

        if (targetType === "c2c") {
            return sendC2CMessage(appId, clientSecret, targetId, content, msgId);
        } else if (targetType === "group") {
            return sendGroupMessage(appId, clientSecret, targetId, content, msgId);
        } else if (targetType === "channel") {
            return sendChannelMessage(appId, clientSecret, targetId, content, msgId);
        } else {
            throw new Error(`不支持的目标类型: ${targetType}`);
        }
    }
}