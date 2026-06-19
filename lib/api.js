import https from "https";
import { logger, retry, getNextMsgSeq } from "./utils.js";

const API_BASE = "api.sgroup.qq.com";
const TOKEN_HOST = "bots.qq.com";
const TOKEN_PATH = "/app/getAppAccessToken";

/**
 * 使用 https 模块发起请求
 */
function httpsRequest(hostname, path, method, headers, postData = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
        };

        if (postData) {
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const json = data ? JSON.parse(data) : null;
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

/**
 * Token 缓存
 */
const tokenCache = new Map();
const tokenPromises = new Map();

/**
 * 获取 Access Token
 */
export async function getAccessToken(appId, clientSecret) {
    const key = String(appId).trim();

    // 检查缓存
    const cached = tokenCache.get(key);
    if (cached && Date.now() < cached.expiresAt - Math.min(5 * 60 * 1000, cached.expiresAt / 3)) {
        return cached.token;
    }

    // Singleflight
    let promise = tokenPromises.get(key);
    if (!promise) {
        promise = (async () => {
            try {
                logger.debug(`获取 Token: appId=${key}`);
                const postData = JSON.stringify({ appId: key, clientSecret });
                const result = await httpsRequest(
                    TOKEN_HOST,
                    TOKEN_PATH,
                    'POST',
                    {},
                    postData
                );

                if (result.status !== 200) {
                    throw new Error(`获取 Token 失败: HTTP ${result.status} - ${result.raw}`);
                }

                const data = result.data;
                if (!data.access_token) {
                    throw new Error(`获取 Token 失败: ${JSON.stringify(data)}`);
                }

                const expiresAt = Date.now() + (data.expires_in || 7200) * 1000;
                tokenCache.set(key, { token: data.access_token, expiresAt });
                logger.debug(`Token 已获取, 有效期 ${Math.round((expiresAt - Date.now()) / 1000)}s`);

                return data.access_token;
            } finally {
                tokenPromises.delete(key);
            }
        })();
        tokenPromises.set(key, promise);
    }

    return promise;
}

/**
 * 清除 Token 缓存
 */
export function clearTokenCache(appId) {
    if (appId) {
        tokenCache.delete(String(appId).trim());
    } else {
        tokenCache.clear();
    }
}

/**
 * 通用 API 请求
 */
export async function apiRequest(accessToken, method, path, body, timeoutMs = 30000) {
    const postData = body ? JSON.stringify(body) : null;
    const headers = {
        'Authorization': `QQBot ${accessToken}`,
        'User-Agent': 'QQBot-Framework/1.0',
    };

    logger.debug(`>>> ${method} ${path}`);
    const result = await httpsRequest(
        API_BASE,
        path,
        method,
        headers,
        postData
    );

    if (result.status < 200 || result.status >= 300) {
        throw new Error(`API 错误: HTTP ${result.status} - ${result.raw}`);
    }

    return result.data;
}

/**
 * 带 Token 自动刷新的请求
 */
export async function apiRequestWithAuth(appId, clientSecret, method, path, body, timeoutMs) {
    return retry(async () => {
        const token = await getAccessToken(appId, clientSecret);
        try {
            return await apiRequest(token, method, path, body, timeoutMs);
        } catch (e) {
            if (e.message.includes('401') || e.message.includes('token')) {
                clearTokenCache(appId);
            }
            throw e;
        }
    });
}

// ============ 消息发送 ============

export async function sendC2CMessage(appId, clientSecret, openid, content, msgId) {
    const token = await getAccessToken(appId, clientSecret);
    const body = {
        msg_type: 0,
        content,
        msg_seq: getNextMsgSeq(),
    };
    if (msgId) body.msg_id = msgId;
    return apiRequest(token, 'POST', `/v2/users/${openid}/messages`, body);
}

export async function sendGroupMessage(appId, clientSecret, groupOpenid, content, msgId) {
    const token = await getAccessToken(appId, clientSecret);
    const body = {
        msg_type: 0,
        content,
        msg_seq: getNextMsgSeq(),
    };
    if (msgId) body.msg_id = msgId;
    return apiRequest(token, 'POST', `/v2/groups/${groupOpenid}/messages`, body);
}

export async function sendChannelMessage(appId, clientSecret, channelId, content, msgId) {
    const token = await getAccessToken(appId, clientSecret);
    const body = { content };
    if (msgId) body.msg_id = msgId;
    return apiRequest(token, 'POST', `/channels/${channelId}/messages`, body);
}

export async function sendMarkdownMessage(appId, clientSecret, target, targetType, content, msgId) {
    const token = await getAccessToken(appId, clientSecret);
    const body = {
        msg_type: 2,
        markdown: { content },  // content 保留 \n 换行
        msg_seq: getNextMsgSeq(),
    };
    if (msgId) body.msg_id = msgId;

    const path = targetType === 'c2c'
        ? `/v2/users/${target}/messages`
        : `/v2/groups/${target}/messages`;
    return apiRequest(token, 'POST', path, body);
}

export async function sendInputNotify(appId, clientSecret, openid, msgId) {
    const token = await getAccessToken(appId, clientSecret);
    const body = {
        msg_type: 6,
        input_notify: { input_type: 1, input_second: 60 },
        msg_seq: getNextMsgSeq(),
    };
    if (msgId) body.msg_id = msgId;
    return apiRequest(token, 'POST', `/v2/users/${openid}/messages`, body);
}

// ============ 富媒体 ============

export async function uploadImage(appId, clientSecret, target, targetType, imageData) {
    const token = await getAccessToken(appId, clientSecret);
    const body = {
        file_type: 1,
        file_data: imageData,
        srv_send_msg: false,
    };
    const path = targetType === 'c2c'
        ? `/v2/users/${target}/files`
        : `/v2/groups/${target}/files`;
    return apiRequest(token, 'POST', path, body);
}

export async function sendImageMessage(appId, clientSecret, target, targetType, imageUrl, msgId, text) {
    let fileInfo;
    if (imageUrl.startsWith('data:') || imageUrl.startsWith('/') || imageUrl.startsWith('~')) {
        const data = imageUrl.startsWith('data:') ? imageUrl.split(',')[1] : imageUrl;
        const result = await uploadImage(appId, clientSecret, target, targetType, data);
        fileInfo = result.file_info;
    } else {
        const token = await getAccessToken(appId, clientSecret);
        const body = {
            msg_type: 7,
            media: { url: imageUrl },
            msg_seq: getNextMsgSeq(),
        };
        if (msgId) body.msg_id = msgId;
        const path = targetType === 'c2c'
            ? `/v2/users/${target}/messages`
            : `/v2/groups/${target}/messages`;
        return apiRequest(token, 'POST', path, body);
    }

    const token = await getAccessToken(appId, clientSecret);
    const body = {
        msg_type: 7,
        media: { file_info: fileInfo },
        msg_seq: getNextMsgSeq(),
    };
    if (msgId) body.msg_id = msgId;
    if (text) body.content = text;
    const path = targetType === 'c2c'
        ? `/v2/users/${target}/messages`
        : `/v2/groups/${target}/messages`;
    return apiRequest(token, 'POST', path, body);
}

// ============ 流式消息 ============

export async function sendStreamMessage(appId, clientSecret, openid, content, inputState = 1, msgId, streamMsgId, msgSeq, index) {
    const token = await getAccessToken(appId, clientSecret);
    const body = {
        input_mode: 'replace',
        input_state: inputState,
        content_type: 'markdown',
        content_raw: content,
        event_id: msgId,
        msg_id: msgId,
        msg_seq: msgSeq || getNextMsgSeq(),
        index: index || 0,
    };
    if (streamMsgId) body.stream_msg_id = streamMsgId;
    return apiRequest(token, 'POST', `/v2/users/${openid}/stream_messages`, body);
}