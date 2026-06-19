/**
 * QQBot 消息发送插件（最终稳定版）
 * 依赖 PluginContext 绑定修复，可安全解构使用
 */

import { createLogger, getBot } from "../lib/exports.js";
import crypto from "node:crypto";

const log = createLogger("SendMsg");

export const metadata = {
    name: "send-msg",
    version: "2.0.0",
    description: "消息发送插件 - 文本/Markdown/图片/审批",
};

// ========== 工具函数 ==========
function parseTarget(target) {
    if (!target || typeof target !== "string") return null;
    if (target.includes(":")) {
        const idx = target.indexOf(":");
        const type = target.slice(0, idx).toLowerCase();
        const id = target.slice(idx + 1);
        if (type === "c2c" || type === "group") return { type, id };
        return { type: "c2c", id: target };
    }
    return { type: "c2c", id: target };
}

function unescape(text) {
    if (!text) return text;
    return text.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
}

function parseQuotedArgs(input) {
    const result = [];
    let current = "", inQuotes = false, quoteChar = "";
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "\\" && i + 1 < input.length) {
            const next = input[i + 1];
            if (next === "n") { current += "\n"; i++; continue; }
            if (next === "t") { current += "\t"; i++; continue; }
            if (next === '"' || next === "'") { current += next; i++; continue; }
            if (next === "\\") { current += "\\"; i++; continue; }
        }
        if (!inQuotes && (ch === '"' || ch === "'")) { inQuotes = true; quoteChar = ch; continue; }
        if (inQuotes && ch === quoteChar) { inQuotes = false; continue; }
        if (!inQuotes && ch === " ") { if (current) { result.push(current); current = ""; } continue; }
        current += ch;
    }
    if (current) result.push(current);
    return result;
}

function parseOptions(args) {
    const options = {}, remaining = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("--")) {
            const key = arg.slice(2);
            if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
                options[key] = args[++i];
            } else {
                options[key] = true;
            }
        } else {
            remaining.push(arg);
        }
    }
    return { options, remaining };
}

// ========== 核心发送 ==========
async function sendMessage(bot, target, content, mode = "text") {
    const { appId, clientSecret } = bot.cfg;
    const parsed = parseTarget(target);
    if (!parsed || !parsed.id || parsed.id.length < 4) {
        return { ok: false, error: `无效目标: "${target}"` };
    }
    const finalContent = unescape(content);
    if (!finalContent || !finalContent.trim()) {
        return { ok: false, error: "内容为空" };
    }
    try {
        const { getAccessToken, apiRequest, sendImageMessage } = await import("../lib/api.js");
        const token = await getAccessToken(appId, clientSecret);
        let body = { msg_seq: Math.floor(Math.random() * 65535) };
        if (mode === "markdown" || mode === "md") {
            body.msg_type = 2;
            body.markdown = { content: finalContent };
        } else if (mode === "image" || mode === "img") {
            const result = await sendImageMessage(appId, clientSecret, parsed.id, parsed.type, finalContent, null);
            return { ok: true, messageId: result?.id, target: parsed, mode };
        } else {
            body.msg_type = 0;
            body.content = finalContent;
        }
        const path = parsed.type === "c2c" ? `/v2/users/${parsed.id}/messages` : `/v2/groups/${parsed.id}/messages`;
        const result = await apiRequest(token, "POST", path, body);
        return { ok: true, messageId: result?.id, target: parsed, mode };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function sendApproval(bot, target, command, description = "") {
    const { appId, clientSecret } = bot.cfg;
    const parsed = parseTarget(target);
    if (!parsed || !parsed.id || parsed.id.length < 4) {
        return { ok: false, error: `无效目标: "${target}"` };
    }
    if (!command || !command.trim()) {
        return { ok: false, error: "命令为空" };
    }
    try {
        const { getAccessToken, apiRequest } = await import("../lib/api.js");
        const token = await getAccessToken(appId, clientSecret);
        const approvalId = `exec:${crypto.randomUUID()}`;
        const lines = [
            "🔐 **命令执行审批**",
            "",
            "```",
            command.slice(0, 500),
            "```",
            "",
            `⏱️ **超时**: 120 秒`,
            `📋 **ID**: \`${approvalId.slice(0, 16)}\``,
        ];
        if (description) lines.splice(2, 0, `📝 **描述**: ${description}`);
        const msgContent = lines.join("\n");
        const keyboard = {
            content: {
                rows: [{
                    buttons: [
                        { id: "allow", render_data: { label: "✅ 允许一次", visited_label: "已允许", style: 1 }, action: { type: 1, data: `approve:${approvalId}:allow-once`, permission: { type: 2 }, click_limit: 1 }, group_id: "approval" },
                        { id: "always", render_data: { label: "⭐ 始终允许", visited_label: "已始终允许", style: 1 }, action: { type: 1, data: `approve:${approvalId}:allow-always`, permission: { type: 2 }, click_limit: 1 }, group_id: "approval" },
                        { id: "deny", render_data: { label: "❌ 拒绝", visited_label: "已拒绝", style: 0 }, action: { type: 1, data: `approve:${approvalId}:deny`, permission: { type: 2 }, click_limit: 1 }, group_id: "approval" },
                    ]
                }]
            }
        };
        const body = {
            msg_type: 2,
            markdown: { content: msgContent },
            msg_seq: Math.floor(Math.random() * 65535),
            keyboard,
        };
        const path = parsed.type === "c2c" ? `/v2/users/${parsed.id}/messages` : `/v2/groups/${parsed.id}/messages`;
        const result = await apiRequest(token, "POST", path, body);
        return { ok: true, approvalId, messageId: result?.id, target: parsed };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ========== 插件入口 ==========
export default async function (ctx) {
    const { logger, on, addCmd, cmd, reply } = ctx;
    const bot = getBot();

    if (!bot) {
        logger.error("❌ Bot 实例未初始化");
        return;
    }
    logger.info("✅ 加载中...");

    // 消息监听
    on("message.group", (msg) => {
        if (msg.content === "test") reply(msg, `⏰ ${Date.now()}`);
        if (msg.content === "ping") reply(msg, "pong");
    });

    // 斜杠指令
    cmd("send", "发送消息", async (msg, args) => {
        if (!args) return "用法: /send <目标> <内容>";
        const parts = parseQuotedArgs(args);
        if (parts.length < 2) return "❌ 缺少目标或内容";
        const target = parts[0];
        const content = parts.slice(1).join(" ");
        let mode = "text", finalContent = content;
        if (content.startsWith("md:")) { mode = "markdown"; finalContent = content.slice(3).trim(); }
        else if (content.startsWith("img:")) { mode = "image"; finalContent = content.slice(4).trim(); }
        const result = await sendMessage(bot, target, finalContent, mode);
        return result.ok ? `✅ 已发送 (ID: ${result.messageId || "N/A"})` : `❌ ${result.error}`;
    });

    // 后台命令
    addCmd("sendmsg", "统一发送", async (args) => {
        if (args.length < 4) {
            logger.info("用法: /sendmsg <c2c|group> <目标> <text|md|image|approve> [--cmd ...] <内容>");
            return null;
        }
        const type = args[0].toLowerCase();
        const target = args[1];
        const mode = args[2].toLowerCase();
        if (!["c2c", "group"].includes(type)) { logger.error("类型错误"); return null; }
        const rest = args.slice(3);
        const { options, remaining } = parseOptions(rest);
        const content = remaining.join(" ");
        const targetStr = `${type}:${target}`;

        if (mode === "approve") {
            const cmd = options.cmd || options.command;
            if (!cmd) { logger.error("需要 --cmd"); return null; }
            const desc = options.desc || "";
            const result = await sendApproval(bot, targetStr, cmd, desc);
            if (result.ok) logger.info(`✅ 审批已发送: ${result.approvalId.slice(0, 8)}...`);
            else logger.error(`❌ ${result.error}`);
            return null;
        }

        if (!content) { logger.error("内容为空"); return null; }
        let actualMode = mode;
        if (mode === "md") actualMode = "markdown";
        if (mode === "img") actualMode = "image";
        const result = await sendMessage(bot, targetStr, content, actualMode);
        if (result.ok) logger.info(`✅ 已发送 (${result.mode})`);
        else logger.error(`❌ ${result.error}`);
        return null;
    });

    addCmd("approve", "发送审批", async (args) => {
        if (args.length < 2) {
            logger.info("用法: /approve <目标> <命令> [--desc 描述]");
            return null;
        }
        const target = args[0];
        const rest = args.slice(1);
        const { options, remaining } = parseOptions(rest);
        const command = remaining.join(" ");
        const desc = options.desc || "";
        const result = await sendApproval(bot, target, command, desc);
        if (result.ok) logger.info(`✅ 审批已发送: ${result.approvalId.slice(0, 8)}...`);
        else logger.error(`❌ ${result.error}`);
        return null;
    });

    addCmd("send", "快捷发送", async (args) => {
        if (args.length < 2) {
            logger.info("用法: /send <目标> <内容>");
            return null;
        }
        const target = args[0];
        const content = args.slice(1).join(" ");
        const result = await sendMessage(bot, target, content, "text");
        if (result.ok) logger.info(`✅ 已发送`);
        else logger.error(`❌ ${result.error}`);
        return null;
    });

    logger.info(`✅ 插件加载完成 (${metadata.version})`);
}