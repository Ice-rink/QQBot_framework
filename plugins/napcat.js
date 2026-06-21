import { getBot } from "../lib/exports.js";
import { logger } from "../lib/utils.js";

export const metadata = {
    name: "NapCat-Msg",
    version: "1.0.0",
    description: "返回一个假的NapCat信息"
};

export default async function (QQBot) {
    const { logger, addCmd, cmd, reply } = QQBot;

    QQBot.on("message.c2c", (pack) => {
        // logger.info(JSON.stringify(pack, null, 4));
        if (pack.content.includes("#napcat")) reply(pack, [
            "NapCat 信息",
            "版本: 1.14.514",
            "平台: linux(128 - bit)",
            "运行时间: 114514天 1919小时 810分钟"
        ].join("\n"))
    })
}