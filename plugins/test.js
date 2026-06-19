/**
 * QQBot 测试插件
 */

import { logger } from "../lib/utils.js";

export const metadata = {
    name: "test-plugin",
    version: "1.0.0",
    description: "QQBot 测试插件",
};

export function register(bot) {
    logger.info(`[test-plugin] 加载中...`);

    // ============ /test - 返回当前时间戳 ============
    bot.command("test", "返回当前时间戳", async (msg, args) => {
        const timestamp = Date.now();
        const isoString = new Date(timestamp).toISOString();

        let format = args?.trim() || "full";

        switch (format) {
            case "ms":
                return `⏱️ ${timestamp}`;
            case "iso":
                return `📅 ${isoString}`;
            case "local":
                return `🕐 ${new Date(timestamp).toLocaleString()}`;
            default:
                return [
                    `⏱️ 时间戳: ${timestamp}`,
                    `📅 ISO: ${isoString}`,
                    `🕐 本地: ${new Date(timestamp).toLocaleString()}`,
                    `⏰ UTC: ${new Date(timestamp).toUTCString()}`,
                ].join("\n");
        }
    });

    // ============ /echo - 回显 ============
    bot.command("echo", "回显消息", async (msg, args) => {
        if (!args) {
            return "❌ 请提供要回显的内容\n用法: /echo <消息>";
        }
        return `🔊 ${args}`;
    });

    // ============ /stats - 统计 ============
    bot.command("stats", "显示运行统计", async () => {
        const gateway = bot.gateway;
        const uptime = bot._startTime ? Date.now() - bot._startTime : 0;

        return [
            "### 📊 QQBot 统计信息",
            "",
            `🤖 状态: ${bot.isRunning ? "✅ 运行中" : "❌ 已停止"}`,
            `🔗 会话: ${gateway?.sessionId || "未连接"}`,
            `📨 消息序号: ${gateway?.lastSeq || "N/A"}`,
            `⏰ 运行时间: ${formatUptime(uptime)}`,
        ].join("\n");
    });

    // ============ /uptime - 运行时间 ============
    bot.command("uptime", "显示运行时间", async () => {
        const uptime = bot._startTime ? Date.now() - bot._startTime : 0;
        return `⏱️ 已运行: ${formatUptime(uptime)}`;
    });

    bot._startTime = Date.now();

    logger.info(`[test-plugin] ✅ 已加载 (v${metadata.version})`);
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

export default { metadata, register };