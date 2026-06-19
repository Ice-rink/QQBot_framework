#!/usr/bin/env node

import { createClient, logger } from "./lib/exports.js";
import http from "node:http";
import url from "node:url";

const CONFIG_PATH = process.env.QQBOT_CONFIG || "./config.json";

const client = createClient(CONFIG_PATH);

// ============ 事件监听 ============
client.on("resumed", () => {
    logger.info("会话恢复");
});

client.on("interaction", (data) => {
    logger.info(`交互事件: ${data.id}`);
});

// ============ 自定义指令 ============

client.command("echo", "回显消息", async (msg, args) => {
    return args || "请提供要回显的内容";
});

client.command("time", "当前时间", async () => {
    return `🕐 当前时间: ${new Date().toLocaleString()}`;
});

// ============ Webhook 服务器 ============

export function startWebhookServer(port = 3000) {
    const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url, true);

        if (parsedUrl.pathname === "/webhook") {
            if (req.method !== "POST") {
                res.writeHead(405);
                res.end("Method Not Allowed");
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const payload = JSON.parse(body);
                    logger.info(`Webhook 收到事件: ${payload.t || "unknown"}`);
                    res.writeHead(200);
                    res.end(JSON.stringify({ op: 12, d: 0 }));
                } catch (e) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (parsedUrl.pathname === "/health") {
            res.writeHead(200);
            res.end(JSON.stringify({
                status: "ok",
                running: client.isRunning,
                session: client.gateway?.sessionId || null,
            }));
            return;
        }

        res.writeHead(404);
        res.end("Not Found");
    });

    server.listen(port, () => {
        logger.info(`Webhook 服务运行在端口 ${port}`);
    });

    return server;
}

// ============ CLI 入口 ============

if (import.meta.url === `file://${process.argv[1]}`) {
    const command = process.argv[2];

    switch (command) {
        case "start":
            // 加载插件并启动
            (async () => {
                try {
                    await client.loadPlugins("./plugins");
                    await client.start();
                } catch (e) {
                    logger.error(`启动失败: ${e.message}`);
                    process.exit(1);
                }
            })();
            break;

        case "webhook":
            (async () => {
                try {
                    await client.loadPlugins("./plugins");
                    await client.start();
                    startWebhookServer(parseInt(process.argv[3]) || 3000);
                } catch (e) {
                    logger.error(`启动失败: ${e.message}`);
                    process.exit(1);
                }
            })();
            break;

        case "stop":
            client.stop();
            break;

        default:
            console.log(`
QQBot Framework

用法:
  node index.js start      # 启动 WebSocket 模式
  node index.js webhook    # 启动 Webhook 模式 (端口可选)
  node index.js stop       # 停止

环境变量:
  QQBOT_CONFIG   配置文件路径 (默认: ./config.json)
  DEBUG          启用调试日志
`);
    }
}

export default client;