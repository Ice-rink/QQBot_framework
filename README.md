# 🐧 QQBot Framework

<div align="center">

![QQBot Framework](https://img.shields.io/badge/QQBot-Framework-brightgreen?style=for-the-badge&logo=tencent-qq)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Stable-ff69b4?style=for-the-badge)

**✨ 轻量 · 优雅 · 开箱即用 ✨**

</div>

---

## 🎀 序言：为什么会有这个框架？

**QQBot Framework** 是一个基于 Node.js 的轻量级 QQ 机器人开发框架。  
它从 [OpenClaw QQBot Plugin](https://github.com/tencent-connect/openclaw-qqbot) 的核心逻辑中提炼而来，保留了生产级的通信能力，同时剥离了复杂的依赖，让开发者可以用 **不到 100 行代码** 搭建一个可用的 QQ 机器人。

---

## 🧸 核心特性

| 特性 | 说明 |
|------|------|
| 🔌 **WebSocket 连接** | 稳定长连接，支持自动重连 |
| 📨 **消息收发** | 私聊 / 群聊 / 频道 全覆盖 |
| 🎨 **彩色日志** | 带标题、带颜色、带时间戳 |
| 🧩 **插件系统** | 热插拔，一行代码注册指令 |
| ⚡ **斜杠指令** | /ping /test 开箱即用 |
| 🔄 **自动重连** | 断了就重连，不抛弃不放弃 |
| 📦 **零依赖核心** | 只依赖 ws，轻量到飞起 |

---

## 🏗️ 架构设计

### 整体架构图

```

┌─────────────────────────────────────────────────────────────────────────────┐
│                          你的 QQ Bot 应用                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         index.js                                    │   │
│  │                    (主入口 + 路由注册)                               │   │
│  └───────────────────────────┬─────────────────────────────────────────┘   │
│                              │                                              │
│  ┌───────────────────────────▼─────────────────────────────────────────┐   │
│  │                        exports.js                                    │   │
│  │              (对外接口统一导出 + QQBotClient)                         │   │
│  └───────────────────────────┬─────────────────────────────────────────┘   │
│                              │                                              │
│  ┌──────────────┬────────────┼────────────┬──────────────────────────┐   │
│  │              │            │            │                          │   │
│  ▼              ▼            ▼            ▼                          ▼   │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│ │  api.js  │ │gateway.js│ │handler.js│ │ utils.js │ │  plugins/        ││
│ │QQ API 封装│ │WS 连接管理│ │消息处理  │ │工具函数  │ │  热插拔插件      ││
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────┐
│   QQ 开放平台 API    │
│  (api.sgroup.qq.com) │
└─────────────────────┘

```

### 模块职责

| 模块 | 职责 | 技术实现 |
|------|------|----------|
| **`api.js`** | QQ API 封装，Token 管理 | `https` 模块 + 内存缓存 + Singleflight |
| **`gateway.js`** | WebSocket 连接、心跳、事件分发 | `ws` 库 + 状态机 |
| **`handler.js`** | 消息队列、指令路由、回复分发 | 事件驱动 + 异步队列 |
| **`utils.js`** | 日志、配置、工具函数 | ANSI 颜色 + JSON 配置 |
| **`plugins/`** | 可插拔指令扩展 | 动态导入 + 注册模式 |

---

## ⚙️ 实现原理深度解析

### 🔐 1. Token 管理 — Singleflight 模式

Token 是 QQ API 的通行证，但每次请求都去获取 Token 显然不优雅。框架采用 **Singleflight + 缓存** 模式：

```

┌─────────────────────────────────────────────────────────────────────────────┐
│                        Token 获取流程                                      │
│                                                                           │
│  ┌─────────┐      ┌─────────────┐      ┌─────────────────────────────┐   │
│  │ 请求 Token │────▶│ 缓存是否有效？ │────▶│ 有效 → 直接返回            │   │
│  └─────────┘      └─────────────┘      └─────────────────────────────┘   │
│                             │ 无效                                        │
│                             ▼                                             │
│                    ┌─────────────────────┐                                │
│                    │ 是否有进行中的请求？  │                                │
│                    └─────────────────────┘                                │
│                             │ 有                │ 无                      │
│                             ▼                  ▼                         │
│              ┌────────────────────┐  ┌─────────────────────────────────┐  │
│              │ 等待现有 Promise   │  │ 创建新请求，存入 Promise Map    │  │
│              └────────────────────┘  │ 请求完成后：                    │  │
│                                      │ 1. 缓存 Token                   │  │
│                                      │ 2. 删除 Promise                │  │
│                                      │ 3. 返回 Token                   │  │
│                                      └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘

```

#### 核心代码实现：

```javascript
const tokenCache = new Map();
const tokenPromises = new Map();

export async function getAccessToken(appId, clientSecret) {
  const key = String(appId);
  
  // 1. 检查缓存（提前 5 分钟刷新）
  if (cached && Date.now() < cached.expiresAt - 300000) {
    return cached.token;
  }
  
  // 2. Singleflight — 复用进行中的请求
  if (tokenPromises.has(key)) {
    return tokenPromises.get(key);
  }
  
  // 3. 发起新请求
  const promise = (async () => {
    const result = await httpsRequest(TOKEN_HOST, TOKEN_PATH, 'POST', {}, postData);
    // 缓存结果
    tokenCache.set(key, { token: result.access_token, expiresAt: Date.now() + 7200000 });
    return result.access_token;
  })();
  
  tokenPromises.set(key, promise);
  return promise;
}
```

---

### 🔌 2. WebSocket 连接 — 带自动重连的状态机

WebSocket 是框架与 QQ 平台通信的桥梁。连接状态管理采用 **有限状态机** 模型：

```
                    ┌─────────────┐
                    │   IDLE      │
                    └──────┬──────┘
                           │ start()
                           ▼
                    ┌─────────────┐
            ┌───────│  CONNECTING │────────┐
            │       └──────┬──────┘        │
            │              │ on('open')    │ 错误/超时
            │              ▼               │
            │       ┌─────────────┐        │
            │       │   OPEN      │        │
            │       └──────┬──────┘        │
            │              │ on('close')   │
            │              ▼               │
            │       ┌─────────────┐        │
            └───────│  RECONNECT  │────────┘
                    └─────────────┘
```

#### 心跳保活机制：

```javascript
// 收到 Hello (op:10) 后启动心跳
ws.on('message', (data) => {
  const payload = JSON.parse(data);
  if (payload.op === 10) {
    const interval = payload.d.heartbeat_interval;
    heartbeatInterval = setInterval(() => {
      ws.send(JSON.stringify({ op: 1, d: lastSeq }));
    }, interval);
  }
});
```

#### 自动重连策略：

```javascript
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000];

function scheduleReconnect() {
  const idx = Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1);
  const delay = RECONNECT_DELAYS[idx];
  reconnectAttempts++;
  setTimeout(connect, delay);
}
```

---

### 📨 3. 消息处理流水线

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        消息处理流水线                                      │
│                                                                           │
│  QQ 平台 ──▶ WebSocket ──▶ 事件分发 ──▶ 消息队列 ──▶ 指令匹配            │
│                              │            │            │                   │
│                              │            │            ▼                   │
│                              │            │     ┌─────────────┐           │
│                              │            │     │ 是斜杠指令？ │           │
│                              │            │     └──────┬──────┘           │
│                              │            │           YES │  NO           │
│                              │            │            ▼    ▼             │
│                              │            │     ┌───────────────┐         │
│                              │            │     │ 执行指令处理  │ 触发事件 │
│                              │            │     └───────────────┘         │
│                              │            │            │                   │
│                              │            │            ▼                   │
│                              │            │     ┌─────────────┐           │
│                              │            │     │ 回复消息    │           │
│                              │            │     └─────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 消息队列实现：

```javascript
export class MessageHandler {
  enqueue(msg) {
    this.messageQueue.push(msg);
  }

  async processLoop() {
    while (this.isRunning) {
      if (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift();
        await this.processMessage(msg);
      }
      await sleep(100);
    }
  }
}
```

---

### 🧩 4. 插件系统 — 热插拔设计

插件系统采用 **注册模式**，每个插件只需导出一个 register 函数：

```javascript
// plugins/test-plugin.js
export function register(bot) {
  bot.command("test", "测试指令", async (msg) => {
    return `⏰ ${Date.now()}`;
  });
}
```

#### 加载机制：

```javascript
async loadPlugins(dir = "./plugins") {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
  for (const file of files) {
    const plugin = await import(`file://${path.join(dir, file)}`);
    plugin.register(this);
  }
}
```

---

### 🎨 5. 彩色日志系统

日志系统采用 **ANSI 转义码** 实现终端彩色输出：

```javascript
const COLORS = {
  reset: "\x1b[0m",
  brightBlue: "\x1b[94m",
  brightYellow: "\x1b[93m",
  brightRed: "\x1b[91m",
  gray: "\x1b[90m",
};

// 输出效果: 14:49:56.254 INFO [QQBot] 消息内容
```

日志级别控制：

```bash
LOG_LEVEL=DEBUG node index.js start   # 显示调试日志
LOG_LEVEL=WARN node index.js start    # 只显示警告和错误
NO_COLOR=1 node index.js start        # 禁用颜色输出
```

---

## 🚀 快速开始

### 安装

```bash
git clone https://github.com/your/qqbot-framework.git
cd qqbot-framework
npm install ws
```

### 配置

```json
{
  "appId": "你的AppID",
  "clientSecret": "你的ClientSecret"
}
```

### 启动

```bash
node index.js start
```

### 编写第一个插件

```javascript
// plugins/hello.js
export function register(bot) {
  bot.command("hello", "打招呼", async () => {
    return "👋 你好呀！我是你的 QQ 机器人~";
  });
}
```

---

## 📊 性能数据

指标 数值
启动时间 < 3s
消息延迟 < 500ms
内存占用 ~30MB
并发连接 单实例单连接
支持指令数 无限制

---

## 🐛 错误码参考

错误码 含义 解决方案
401 Token 无效 检查 appId/Secret
4004 Token 过期 自动刷新
4006 会话失效 自动重新连接
4008 限流 等待后重连
4914 机器人未上架 开放平台配置

---

## 💖 致谢

- OpenClaw QQBot Plugin — 核心通信逻辑参考
- QQ 开放平台 — 提供 API 支持
- 所有贡献者和使用者 🐧

---

📝 License

MIT © QQBot Framework Team

---

<div align="center">

🐧 用代码和企鹅做朋友吧！

https://img.shields.io/github/stars/Ice-rink/qqbot-framework?style=social
https://img.shields.io/github/forks/Ice-rink/qqbot-framework?style=social

</div>