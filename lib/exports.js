/**
 * QQBot 框架核心模块（重构版）
 * 提供简洁 API：on, addCmd, send, reply, cmd, ...
 */

import { QQGateway } from "./gateway.js";
import { MessageHandler } from "./handler.js";
import { Config, createLogger as _createLogger, addCmd as _addCmd, getBackendCommands, executeBackendCommand } from "./utils.js";
import * as api from "./api.js";
import { QQBot } from "./QQBot.js";   // <--- 新增导入

// ============ 内部单例 ============
let _bot = null;
let _defaultLogger = _createLogger("QQBot");

/**
 * 设置 Bot 实例（框架内部调用）
 */
export function setBot(bot) {
    _bot = bot;
}

/**
 * 获取 Bot 实例
 */
export function getBot() {
    return _bot;
}

// ============ 对外 API ============

/**
 * 注册后台命令
 * 原名: registerBackendCommand
 */
export function addCmd(name, desc, handler) {
    return _addCmd(name, desc, handler);
}

/**
 * 监听事件
 * 支持点分隔事件名: 'message', 'message.c2c', 'message.group', 'message.channel'
 */
export function on(event, handler) {
    if (!_bot) throw new Error("Bot 未初始化，请先启动框架");
    _bot.on(event, handler);
}

/**
 * 发送消息（通用）
 * @param {string} target - "c2c" 或 "group"
 * @param {string} targetId - openid 或 group_openid
 * @param {string} content - 消息内容
 * @param {string} mode - "text" | "markdown"
 */
export function send(target, content, mode = "text") {
    if (!_bot) throw new Error("Bot 未初始化");
    return _bot.send(target, content, mode);
}

/**
 * 回复消息
 */
export function reply(msg, content, options = {}) {
    if (!_bot) throw new Error("Bot 未初始化");
    return _bot.reply(msg, content, options);
}

/**
 * 发送私聊消息
 */
export function sendC2C(openid, content) {
    return send("c2c", openid, content);
}

/**
 * 发送群聊消息
 */
export function sendGroup(groupOpenid, content) {
    return send("group", groupOpenid, content);
}

/**
 * 发送图片消息
 */
export function sendImage(type, target, url, msgId, text) {
    if (!_bot) throw new Error("Bot 未初始化");
    return _bot.sendImage(type, target, url, msgId, text);
}

/**
 * 注册斜杠指令
 * 原名: command
 */
export function cmd(name, desc, handler) {
    if (!_bot) throw new Error("Bot 未初始化");
    _bot.command(name, desc, handler);
}

/**
 * 获取配置
 */
export function getConfig() {
    if (!_bot) throw new Error("Bot 未初始化");
    return _bot.cfg;
}

/**
 * 获取网关实例
 */
export function getGateway() {
    if (!_bot) throw new Error("Bot 未初始化");
    return _bot.gateway;
}

/**
 * 获取消息处理器
 */
export function getHandler() {
    if (!_bot) throw new Error("Bot 未初始化");
    return _bot.handler;
}

/**
 * 创建日志器
 */
export function createLogger(name) {
    return _createLogger(name);
}

/**
 * 启动 Bot（框架内部使用）
 */
export async function startBot() {
    if (!_bot) throw new Error("Bot 未初始化");
    return _bot.start();
}

/**
 * 停止 Bot
 */
export function stopBot() {
    if (!_bot) throw new Error("Bot 未初始化");
    return _bot.stop();
}

/**
 * 加载插件
 */
export async function loadPlugin(name, pluginFn) {
    if (!_bot) throw new Error("Bot 未初始化");
    return _bot.load(name, pluginFn);
}

/**
 * 加载插件目录
 */
export async function loadPlugins(dir = "./plugins") {
    if (!_bot) throw new Error("Bot 未初始化");
    return _bot.loadDir(dir);
}

/**
 * 创建 Bot 实例（工厂函数）
 */
export function createBot(configPath) {
    // 已通过 import 导入 QQBot 类，直接使用
    return new QQBot(configPath);
}

// ============ 导出底层 API ============
export { api, getBackendCommands, executeBackendCommand };

// ============ 默认导出（供插件 import * as QQBot 使用） ============
const QQBotAPI = {
    on,
    addCmd,
    send,
    reply,
    sendC2C,
    sendGroup,
    sendImage,
    cmd,
    getConfig,
    getGateway,
    getHandler,
    createLogger,
    api,
    setBot,
    getBot,
    startBot,
    stopBot,
    loadPlugin,
    loadPlugins,
    createBot,
    getBackendCommands,
    executeBackendCommand,
};

export default QQBotAPI;