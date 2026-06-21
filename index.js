#!/usr/bin/env node

import { createBot, setBot, createLogger, loadPlugins, startBot, on, addCmd } from "./lib/exports.js";
import { executeBackendCommand, initBackendCommands } from "./lib/utils.js";
import readline from "node:readline";
import http from "node:http";
import url from "node:url";

// ============ 全局异常捕获 ============
process.on('unhandledRejection', (reason, promise) => {
    log.error(`⚠️ 未处理的 Promise 拒绝:`);
    if (reason instanceof Error) {
        log.error(`   ${reason.message}`);
        log.error(`   ${reason.stack}`);
    } else {
        log.error(`   ${reason}`);
    }
});

process.on('uncaughtException', (error) => {
    log.error(`💥 未捕获的异常: ${error.message}`);
    log.error(error.stack);
    // 不要退出进程，继续运行
});

const CONFIG_PATH = process.env.QQBOT_CONFIG || "./config.json";

const log = createLogger("Main");
const client = createBot(CONFIG_PATH);

// 将 Bot 注入全局 API 对象
setBot(client);

// 初始化后台指令系统
initBackendCommands();

// ============ 终端交互 ============

let rl = null;

function startRepl() {
    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: ``,
        terminal: true,
    });

    rl.on("line", async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }

        const result = await executeBackendCommand(input);
        if (result) {
            if (result.error) {
                log.error(`❌ ${result.message}`);
            } else if (result.message !== null) {
                log.info(result.message);
            }
        }

        rl.prompt();
    });

    rl.on("close", () => {
        log.info("Stoping...\n👋 终端已关闭");
        process.exit(0);
    });

    rl.on("SIGINT", () => {
        log.info("\n");
        rl.close();
    });

    rl.prompt();
}

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
                    log.info(`Webhook 收到事件: ${payload.t || "unknown"}`);
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
        log.info(`Webhook 服务运行在端口 ${port}`);
    });

    return server;
}

// ============ CLI 入口 ============

if (import.meta.url === `file://${process.argv[1]}`) {
    const command = process.argv[2];

    switch (command) {
        case "start":
            (async () => {
                try {
                    logoLog();
                    log.info("正在加载插件...");
                    await loadPlugins("./plugins");
                    log.info("正在启动 QQBot...");
                    await startBot();
                    startRepl();
                } catch (e) {
                    log.error(`启动失败: ${e.message}`);
                    process.exit(1);
                }
            })();
            break;

        case "webhook":
            (async () => {
                try {
                    await loadPlugins("./plugins");
                    await startBot();
                    startWebhookServer(parseInt(process.argv[3]) || 3000);
                    startRepl();
                } catch (e) {
                    log.error(`启动失败: ${e.message}`);
                    process.exit(1);
                }
            })();
            break;

        default:
            log.info(`
\x1b[96mQQBot Framework\x1b[0m

\x1b[93m用法:\x1b[0m
    node index.js start              # 启动 WebSocket 模式 + 终端控制台
    node index.js webhook [port]     # 启动 Webhook 模式 + 终端控制台

\x1b[93m环境变量:\x1b[0m
    QQBOT_CONFIG   配置文件路径 (默认: ./config.json)
    LOG_LEVEL      日志级别 (DEBUG/INFO/WARN/ERROR)
    NO_COLOR       禁用颜色输出
`);
    }
}

function logoLog() {
    log.info(`   ____     ____    ____            _   `);
    log.info(`  / __ \\   / __ \\  |  _ \\          | |  `);
    log.info(` | |  | | | |  | | | |_) |   ___   | |_ `);
    log.info(` | |  | | | |  | | |  _ <   / _ \\  | __|`);
    log.info(` | |__| | | |__| | | |_) | | (_) | | |_ `);
    log.info(`  \\___\\_\\  \\___\\_\\ |____/   \\___/   \\__|`);
    log.info(`    ==== QQBot Framework v1.0.0 ===    `);
}

export default client;