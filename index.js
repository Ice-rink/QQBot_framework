#!/usr/bin/env node

/**
 * QQBot Framework 主入口
 * 
 * 用法:
 *   node index.js start              # 启动 WebSocket 模式 + 终端控制台
 *   node index.js webhook [port]     # 启动 Webhook 模式 + 终端控制台
 * 
 * 环境变量:
 *   QQBOT_CONFIG   配置文件路径 (默认: ./config.json)
 *   LOG_LEVEL      日志级别 (DEBUG/INFO/WARN/ERROR)
 *   NO_COLOR       禁用颜色输出
 */

import readline from "node:readline";
import http from "node:http";
import url from "node:url";
import QQBotAPI, { createLogger, addCmd, executeBackendCommand, initBackendCommands, QQBotClass as Bot } from './lib/QQBot.js';

const CONFIG_PATH = process.env.QQBOT_CONFIG || "./config.json";
const bot = new Bot(CONFIG_PATH);
const log = createLogger('Main');

// ============ 全局异常捕获 ============

process.on('unhandledRejection', (reason, promise) => {
    log.error(`未处理的 Promise 拒绝:`);
    if (reason instanceof Error) {
        log.error(`   ${reason.message}`);
        log.error(`   ${reason.stack}`);
    } else {
        log.error(`   ${reason}`);
    }
});

process.on('uncaughtException', (error) => {
    log.error(`未捕获的异常: ${error.message}`);
    log.error(error.stack);
    // 不要退出进程，继续运行
});

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
            } else if (result.message !== null && result.message !== undefined) {
                // 如果返回的是字符串，直接打印
                if (typeof result.message === 'string') {
                    console.log(result.message);
                }
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

// ============ 注册内置后台指令 ============

// /status - 查看 Bot 状态
addCmd("status", "查看 Bot 状态", async () => {
    const status = bot.status || { running: false, session: null, uptime: 0, plugins: [] };
    const lines = [
        "📊 Bot 状态",
        "",
        `  运行状态: ${status.running ? "✅ 运行中" : "❌ 已停止"}`,
        `  会话 ID: ${status.session || "未连接"}`,
        `  运行时间: ${formatTime(status.uptime || 0)}`,
        `  已加载插件: ${status.plugins?.length > 0 ? status.plugins.join(", ") : "无"}`,
    ];
    for (const line of lines) {
        console.log(line);
    }
    return null;
});

// /config - 查看当前配置
addCmd("config", "查看当前配置", async () => {
    const cfg = bot.cfg || {};
    const lines = [
        "📋 当前配置",
        "",
        `  AppID: ${cfg.appId || "未设置"}`,
        `  ClientSecret: ${cfg.clientSecret ? "***已设置***" : "未设置"}`,
        `  Markdown支持: ${cfg.markdownSupport !== false ? "✅" : "❌"}`,
        `  插件配置: ${cfg.plugins ? Object.keys(cfg.plugins).join(", ") : "无"}`,
    ];
    for (const line of lines) {
        console.log(line);
    }
    return null;
});

// /reload - 重新加载配置
addCmd("reload", "重新加载配置文件", async () => {
    try {
        bot.config.load();
        log.info(`✅ 配置已重新加载: ${CONFIG_PATH}`);
    } catch (e) {
        log.error(`❌ 重新加载失败: ${e.message}`);
    }
    return null;
});

// /clear - 清屏
addCmd("clear", "清空终端", async () => {
    console.clear();
    return null;
});

// /exit - 退出
addCmd("exit", "退出程序", async () => {
    log.info("👋 正在退出...");
    setTimeout(() => {
        bot.stop();
        process.exit(0);
    }, 300);
    return null;
});

// ============ 辅助函数 ============

function formatTime(ms) {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m < 60) return `${m}m ${r}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ${r}s`;
}

function logoLog() {
    log.info(`   ____     ____    ____            _   `);
    log.info(`  / __ \\   / __ \\  |  _ \\          | |  `);
    log.info(` | |  | | | |  | | | |_) |   ___   | |_ `);
    log.info(` | |  | | | |  | | |  _ <   / _ \\  | __|`);
    log.info(` | |__| | | |__| | | |_) | | (_) | | |_ `);
    log.info(`  \\___\\_\\  \\___\\_\\ |____/   \\___/   \\__|`);
    log.info(`    ==== QQBot Framework v2.0.0 ===      `);
}

// ============ Webhook 服务器 ============

export function startWebhookServer(port = 3000) {
    const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url, true);

        // CORS
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        // Webhook 端点
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

                    // 分发事件到 gateway
                    if (bot.gateway) {
                        // 这里需要将 webhook 事件转发到 gateway 处理
                        // bot.gateway._handleDispatch(payload.t, payload.d);
                    }

                    res.writeHead(200);
                    res.end(JSON.stringify({ op: 12, d: 0 }));
                } catch (e) {
                    log.error(`Webhook 处理失败: ${e.message}`);
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // 健康检查
        if (parsedUrl.pathname === "/health" || parsedUrl.pathname === "/") {
            const status = bot.status || {};
            res.writeHead(200);
            res.end(JSON.stringify({
                status: status.running ? "ok" : "stopped",
                session: status.session,
                uptime: status.uptime,
                plugins: status.plugins,
                version: "2.0.0",
            }, null, 2));
            return;
        }

        res.writeHead(404);
        res.end("Not Found");
    });

    server.listen(port, "0.0.0.0", () => {
        log.info(`🌐 Webhook 服务运行在端口 ${port}`);
        log.info(`   POST /webhook - 接收 QQ 回调`);
        log.info(`   GET  /health  - 健康检查`);
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
                    await bot.loadDir("./plugins");
                    log.info("正在启动 QQBot...");
                    await bot.start();
                    startRepl();
                } catch (e) {
                    log.error(`启动失败: ${e.message}`);
                    if (e.stack) log.error(e.stack);
                    process.exit(1);
                }
            })();
            break;

        case "webhook":
            (async () => {
                try {
                    logoLog();
                    await bot.loadDir("./plugins");
                    await bot.start();
                    const port = parseInt(process.argv[3]) || 3000;
                    startWebhookServer(port);
                    startRepl();
                } catch (e) {
                    log.error(`启动失败: ${e.message}`);
                    if (e.stack) log.error(e.stack);
                    process.exit(1);
                }
            })();
            break;

        case "stop":
            bot.stop();
            log.info("QQBot 已停止");
            break;

        case "status":
            const status = bot.status || {};
            console.log(`
📊 QQBot 状态
  运行状态: ${status.running ? "✅ 运行中" : "❌ 已停止"}
  会话 ID: ${status.session || "未连接"}
  运行时间: ${formatTime(status.uptime || 0)}
  已加载插件: ${status.plugins?.length > 0 ? status.plugins.join(", ") : "无"}
`);
            break;

        default:
            console.log(`
\x1b[96mQQBot Framework v2.0.0\x1b[0m

\x1b[93m用法:\x1b[0m
  node index.js start              # 启动 WebSocket 模式 + 终端控制台
  node index.js webhook [port]     # 启动 Webhook 模式 + 终端控制台
  node index.js stop               # 停止 Bot
  node index.js status             # 查看状态

\x1b[93m环境变量:\x1b[0m
  QQBOT_CONFIG   配置文件路径 (默认: ./config.json)
  LOG_LEVEL      日志级别 (DEBUG/INFO/WARN/ERROR)
  NO_COLOR       禁用颜色输出

\x1b[93m终端指令:\x1b[0m
  /help      - 显示帮助
  /status    - 查看状态
  /config    - 查看配置
  /reload    - 重新加载配置
  /clear     - 清屏
  /exit      - 退出程序
`);
            break;
    }
}
