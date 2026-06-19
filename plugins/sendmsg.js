/**
 * QQBot 消息发送插件
 * 
 * 功能:
 *   - 后台命令: /sendmsg <类型> <目标> [选项] <内容>
 * 
 * 使用示例:
 *   /sendmsg c2c openid text "你好"
 *   /sendmsg group groupid text "大家好"   # groupid 是群 openid
 *   /sendmsg group groupid md "# 标题"     # Markdown 格式
 */

import { logger, createLogger, registerBackendCommand } from "../lib/utils.js";
import {
    sendC2CMessage,
    sendGroupMessage,
    sendMarkdownMessage,
    sendImageMessage,
    getAccessToken,
    apiRequest
} from "../lib/api.js";

const log = createLogger("SendMsg");
import crypto from "node:crypto";

export const metadata = {
    name: "send-msg",
    version: "1.0.0",
    description: "消息发送插件 - 支持文本/Markdown/图片/审批/群聊",
    author: "QQBot Framework",
};

// ============ 群聊 @提及构建 ============

function buildMentionText(openids) {
    if (!openids || openids.length === 0) return "";
    return openids.map(id => `<@${id}>`).join(" ");
}

function parseMentionArg(value) {
    if (!value) return [];
    return value.split(",").map(s => s.trim()).filter(Boolean);
}

// ============ 审批消息构建 ============

function buildApprovalKeyboard(approvalId) {
    const makeBtn = (id, label, visitedLabel, data, style) => ({
        id,
        render_data: {
            label,
            visited_label: visitedLabel,
            style
        },
        action: {
            type: 1,
            data,
            permission: { type: 2 },
            click_limit: 1,
        },
        group_id: "approval",
    });

    return {
        content: {
            rows: [{
                buttons: [
                    makeBtn("allow", "✅ 允许一次", "已允许", `approve:${approvalId}:allow-once`, 1),
                    makeBtn("always", "⭐ 始终允许", "已始终允许", `approve:${approvalId}:allow-always`, 1),
                    makeBtn("deny", "❌ 拒绝", "已拒绝", `approve:${approvalId}:deny`, 0),
                ]
            }]
        }
    };
}

/**
 * 发送审批消息
 */
async function sendApprovalMessage(bot, target, command, description = "", mentionUsers = []) {
    const { appId, clientSecret } = bot.cfg;
    const parsed = parseTarget(target);

    if (!parsed || !parsed.id || parsed.id.length < 8) {
        return {
            success: false,
            error: `❌ 无效的目标地址: "${target}"`
        };
    }

    if (!command || command.trim().length === 0) {
        return {
            success: false,
            error: "❌ 命令内容不能为空"
        };
    }

    try {
        const token = await getAccessToken(appId, clientSecret);

        const approvalId = `exec:${crypto.randomUUID()}`;
        const expiresAt = Date.now() + 120000;

        let content = [
            "🔐 **命令执行审批**",
            "",
            "```",
            command.slice(0, 300),
            "```",
            "",
            `⏱️ **超时**: ${Math.round((expiresAt - Date.now()) / 1000)} 秒`,
        ];
        if (description) {
            content.splice(2, 0, `📝 **描述**: ${description}`);
        }
        if (parsed.type === "group" && mentionUsers.length > 0) {
            content.push("", `📢 **@提及**: ${mentionUsers.join(", ")}`);
        }
        const msgContent = content.join("\n");

        const keyboard = buildApprovalKeyboard(approvalId);

        const body = {
            msg_type: 2,
            markdown: { content: msgContent },
            msg_seq: Math.floor(Math.random() * 65535),
            keyboard: keyboard,
        };

        if (parsed.type === "group" && mentionUsers.length > 0) {
            body.mentions = mentionUsers.map(id => ({
                user_openid: id,
                member_openid: id,
            }));
        }

        const path = parsed.type === "c2c"
            ? `/v2/users/${parsed.id}/messages`
            : `/v2/groups/${parsed.id}/messages`;

        const result = await apiRequest(token, "POST", path, body);

        log.info(`✅ 审批消息已发送: ${parsed.type} -> ${parsed.id.slice(0, 12)}...`);

        return {
            success: true,
            approvalId,
            expiresAt,
            messageId: result?.id,
            target: parsed,
            command,
        };
    } catch (e) {
        log.error(`❌ 发送审批消息失败: ${e.message}`);
        return {
            success: false,
            error: `❌ 发送失败: ${e.message}`
        };
    }
}

/**
 * 发送普通消息
 */
async function sendMessage(bot, target, content, mode = "text", mentionUsers = []) {
    const { appId, clientSecret } = bot.cfg;
    const parsed = parseTarget(target);

    if (!parsed || !parsed.id || parsed.id.length < 8) {
        return {
            success: false,
            error: `❌ 无效的目标地址: "${target}"`
        };
    }

    const finalContent = parseEscapeChars(content);

    if (!finalContent || finalContent.trim().length === 0) {
        return {
            success: false,
            error: "❌ 消息内容不能为空"
        };
    }

    log.info(`发送消息: ${parsed.type} -> ${parsed.id.slice(0, 12)}..., 模式: ${mode}`);

    try {
        let result;
        const msgId = null;
        const token = await getAccessToken(appId, clientSecret);

        let body = {
            msg_seq: Math.floor(Math.random() * 65535),
        };

        if (mode === "md" || mode === "markdown") {
            body.msg_type = 2;
            body.markdown = { content: finalContent };
        } else if (mode === "image" || mode === "img") {
            result = await sendImageMessage(appId, clientSecret, parsed.id, parsed.type, finalContent, msgId);
            log.info(`✅ 图片消息发送成功: ${result?.id || "unknown"}`);
            return {
                success: true,
                messageId: result?.id,
                timestamp: result?.timestamp,
                target: parsed,
                mode
            };
        } else {
            body.msg_type = 0;
            body.content = finalContent;
        }

        // 群聊 @提及
        if (parsed.type === "group" && mentionUsers.length > 0) {
            body.mentions = mentionUsers.map(id => ({
                user_openid: id,
                member_openid: id,
            }));
            const mentionText = buildMentionText(mentionUsers);
            if (body.content !== undefined) {
                body.content = `${mentionText} ${body.content}`;
            } else if (body.markdown) {
                body.markdown.content = `${mentionText}\n\n${body.markdown.content}`;
            }
        }

        const path = parsed.type === "c2c"
            ? `/v2/users/${parsed.id}/messages`
            : `/v2/groups/${parsed.id}/messages`;

        result = await apiRequest(token, "POST", path, body);

        log.info(`✅ 消息发送成功: ${result?.id || "unknown"}`);
        return {
            success: true,
            messageId: result?.id,
            timestamp: result?.timestamp,
            target: parsed,
            mode
        };
    } catch (e) {
        log.error(`❌ 消息发送失败: ${e.message}`);
        return {
            success: false,
            error: `❌ 发送失败: ${e.message}`
        };
    }
}

// ============ 辅助函数 ============

/**
 * 解析目标地址 - 修复：正确处理 group 类型
 */
function parseTarget(target) {
    if (!target) return null;

    // 检查是否包含冒号 (标准格式)
    if (target.includes(":")) {
        const parts = target.split(":", 2);
        const type = parts[0].toLowerCase();
        const id = parts[1];
        if (type === "c2c" || type === "group") {
            return { type, id };
        }
        // 默认当作 c2c
        return { type: "c2c", id: target };
    }

    // 没有冒号，默认当作 c2c (私聊)
    // 注意：群聊必须使用 group: 前缀
    return { type: "c2c", id: target };
}

function parseEscapeChars(text) {
    if (!text) return text;
    return text
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
        .replace(/\\r/g, '\r')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");
}

/**
 * 解析参数 - 支持引号包裹的内容
 */
function parseArgs(args) {
    const result = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    let i = 0;

    while (i < args.length) {
        const char = args[i];

        if (char === '\\' && i + 1 < args.length) {
            const next = args[i + 1];
            if (next === 'n') {
                current += '\n';
                i += 2;
                continue;
            } else if (next === 't') {
                current += '\t';
                i += 2;
                continue;
            } else if (next === '"' || next === "'") {
                current += next;
                i += 2;
                continue;
            } else if (next === '\\') {
                current += '\\';
                i += 2;
                continue;
            }
        }

        if (!inQuotes && (char === '"' || char === "'")) {
            inQuotes = true;
            quoteChar = char;
            i++;
            continue;
        }
        if (inQuotes && char === quoteChar) {
            inQuotes = false;
            i++;
            continue;
        }

        if (!inQuotes && char === ' ') {
            if (current) {
                result.push(current);
                current = '';
            }
            i++;
            continue;
        }

        current += char;
        i++;
    }

    if (current) {
        result.push(current);
    }

    return result;
}

function parseOptions(args) {
    const options = {};
    const remaining = [];
    let i = 0;

    while (i < args.length) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
                options[key] = args[i + 1];
                i += 2;
            } else {
                options[key] = true;
                i++;
            }
        } else {
            remaining.push(arg);
            i++;
        }
    }

    return { options, remaining };
}

/**
 * 注册插件
 */
export function register(bot) {
    log.info("加载中...");

    // ============ QQ指令: /send ============
    bot.command("send", "发送消息到指定目标", async (msg, args) => {
        if (!args) {
            return [
                "### 📤 发送消息用法",
                "",
                "`/send <目标> <内容>`",
                "",
                "**目标格式:**",
                "  `c2c:openid`  - 发送私聊",
                "  `group:groupid` - 发送群聊 (groupid 是群 openid)",
                "",
                "**内容前缀 (可选):**",
                "  `md:` - Markdown格式",
                "  `img:` - 图片 (路径或URL)",
                "",
                "**转义字符:**",
                "  `\\n` - 换行",
                "  `\\t` - 制表符",
                "",
                "**示例:**",
                "  `/send c2c:E8321BC2 你好`",
                "  `/send group:12345 大家好`",  // 注意：group: 前缀必须
                "  `/send c2c:openid md:# 标题\\n\\n内容`",
            ].join("\n");
        }

        const parts = parseArgs(args);
        if (!parts || parts.length < 2) {
            return "❌ 用法: /send <目标> <内容>";
        }

        const target = parts[0];
        const content = parts.slice(1).join(" ");

        let mode = "text";
        let finalContent = content;

        if (content.startsWith("md:")) {
            mode = "markdown";
            finalContent = content.slice(3).trim();
        } else if (content.startsWith("img:")) {
            mode = "image";
            finalContent = content.slice(4).trim();
        }

        const result = await sendMessage(bot, target, finalContent, mode);

        if (result.success) {
            return [
                `✅ 消息已发送`,
                `  目标: ${result.target.type}:${result.target.id.slice(0, 12)}...`,
                `  模式: ${result.mode}`,
                `  ID: ${result.messageId || "N/A"}`,
            ].join("\n");
        }
        return result.error;
    });

    // ============ 核心: /sendmsg 统一命令 ============
    registerBackendCommand("sendmsg", "统一消息发送命令", async (args) => {
        if (args.length < 4) {
            const lines = [
                "📤 统一消息发送命令 (后台)",
                "",
                "  /sendmsg <类型> <目标> <模式> [选项] <内容>",
                "",
                "类型: c2c | group",
                "",
                "**重要**: 群聊目标请使用 group 类型，不要用数字直接作为目标",
                "",
                "模式:",
                "  text     - 纯文本",
                "  md       - Markdown",
                "  image    - 图片 (路径或URL)",
                "  approve  - 命令执行审批 (带按钮)",
                "",
                "选项 (approve模式):",
                "  --cmd    - 要执行的命令 (必填)",
                "  --desc   - 命令描述 (可选)",
                "",
                "转义: \\n (换行), \\t (制表符)",
                "",
                "示例:",
                '  /sendmsg c2c E8321BC2 text "你好\\n第二行"',
                '  /sendmsg group 1087355660 text "大家好"',  // 正确用法
                '  /sendmsg group 1087355660 md "# 标题\\n\\n内容"',
                '  /sendmsg c2c E8321BC2 approve --cmd "rm -rf /tmp/test"',
                '  /sendmsg group 1087355660 approve --cmd "ls -la" --desc "查看文件列表"',
                '  /sendmsg c2c E8321BC2 image "/path/to/image.png"',
            ];
            for (const line of lines) log.info(line);
            return null;
        }

        // 解析: 类型 目标 模式 内容
        const type = args[0].toLowerCase();
        const target = args[1];
        const mode = args[2].toLowerCase();

        // 验证类型
        if (type !== "c2c" && type !== "group") {
            log.error(`❌ 不支持的类型: "${type}"，请使用 c2c 或 group`);
            return null;
        }

        // 验证目标 ID 长度 (群 openid 通常是 32 位十六进制)
        if (target.length < 8) {
            log.error(`❌ 目标 ID 太短: "${target}"，请确认是有效的 openid`);
            return null;
        }

        // 验证模式
        const validModes = ["text", "md", "markdown", "image", "img", "approve"];
        if (!validModes.includes(mode)) {
            log.error(`❌ 不支持的格式: "${mode}"，请使用 ${validModes.join(", ")}`);
            return null;
        }

        // 提取剩余参数
        const restArgs = args.slice(3);
        const { options, remaining } = parseOptions(restArgs);
        const content = remaining.join(" ");

        // ============ approve 模式 ============
        if (mode === "approve") {
            const cmd = options.cmd || options.command;
            if (!cmd) {
                log.error("❌ approve 模式需要 --cmd 参数指定要执行的命令");
                log.info('  示例: /sendmsg c2c E8321BC2 approve --cmd "rm -rf /tmp/test"');
                return null;
            }

            const desc = options.desc || options.description || "";
            const mentionUsers = options.mention ? parseMentionArg(options.mention) : [];

            // 构建目标: type:id (不带冒号格式)
            const targetStr = `${type}:${target}`;
            const result = await sendApprovalMessage(bot, targetStr, cmd, desc, mentionUsers);

            if (result.success) {
                log.info(`✅ 审批消息已发送: ${result.approvalId.slice(0, 8)}...`);
            } else {
                log.error(result.error);
            }
            return null;
        }

        // ============ 普通消息模式 ============
        if (!content) {
            log.error(`❌ ${mode} 模式需要提供内容`);
            return null;
        }

        let actualMode = mode;
        if (mode === "md") actualMode = "markdown";
        if (mode === "img") actualMode = "image";

        // 构建目标: type:id
        const targetStr = `${type}:${target}`;
        const mentionUsers = options.mention ? parseMentionArg(options.mention) : [];

        const result = await sendMessage(bot, targetStr, content, actualMode, mentionUsers);

        if (result.success) {
            log.info(`✅ 消息已发送 (${result.mode}) -> ${result.target.id.slice(0, 12)}...`);
        } else {
            log.error(result.error);
        }
        return null;
    });

    // ============ 快捷命令: /approve ============
    registerBackendCommand("approve", "发送审批请求 (快捷方式)", async (args) => {
        if (args.length < 2) {
            log.info("🔐 用法: /approve <目标> <命令> [--desc 描述]");
            log.info('  示例: /approve c2c:E8321BC2 "rm -rf /tmp/test"');
            log.info('  示例: /approve group:1087355660 "ls -la" --desc "查看文件列表"');
            return null;
        }

        const target = args[0];
        const rest = args.slice(1);

        const { options, remaining } = parseOptions(rest);
        const command = remaining.join(" ");
        const desc = options.desc || options.description || "";
        const mentionUsers = options.mention ? parseMentionArg(options.mention) : [];

        const result = await sendApprovalMessage(bot, target, command, desc, mentionUsers);

        if (result.success) {
            log.info(`✅ 审批消息已发送: ${result.approvalId.slice(0, 8)}...`);
        } else {
            log.error(result.error);
        }
        return null;
    });

    // ============ 快捷命令: /send ============
    registerBackendCommand("send", "发送消息 (快捷方式)", async (args) => {
        if (args.length < 2) {
            log.info("📤 用法: /send <目标> <内容>");
            log.info('  示例: /send c2c:E8321BC2 "你好"');
            log.info('  示例: /send group:1087355660 "大家好"');
            return null;
        }

        const target = args[0];
        const content = args.slice(1).join(" ");

        // 解析目标格式 (可能是 c2c:xxx 或 group:xxx)
        const parsed = parseTarget(target);
        if (!parsed) {
            log.error(`❌ 无效的目标格式: "${target}"`);
            return null;
        }

        const result = await sendMessage(bot, target, content, "text");

        if (result.success) {
            log.info(`✅ 消息已发送 -> ${result.target.id.slice(0, 12)}...`);
        } else {
            log.error(result.error);
        }
        return null;
    });

    log.info(`✅ 已加载 (v${metadata.version})`);

    return { metadata, register };
}

export default { metadata, register };