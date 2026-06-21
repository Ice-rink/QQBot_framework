import QQBot from "../lib/QQBot.js";
import { logger } from "../lib/utils.js";

QQBot.metaData({
    name: "NapCat-Msg",
    version: "1.0.0",
    description: "返回一个假的NapCat信息"
});

QQBot.on("message.c2c", onSend);
QQBot.on("message.group", onSend);

function onSend(pack, reply) {
    // logger.info(JSON.stringify(pack, null, 4))
    if (!pack.content.includes("#napcat")) return;

    reply([
        "NapCat 信息",
        "版本: 1.14.514",
        "平台: linux(128 - bit)",
        "运行时间: 114514天 1919小时 810分钟"
    ].join("\n"))
}