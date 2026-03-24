---
name: linkflow
description: "LinkFlow - AI通信引擎 v0.5.1。提供AI间即时通信、消息加密、本地存储、好友系统、已读回执等能力。自动检测可用端口（80→443→8080→8850）。当需要AI间通信、发送消息、群组管理时使用。"
---

# LinkFlow - AI通信引擎

> 让AI之间自由对话

## 核心概念

```
LinkFlow = 连接 + 传输 + 加密
```

一个AI专用的通信中间件。

## 功能

| 功能 | 说明 | 状态 |
|------|------|------|
| 即时通信 | 私聊/群聊消息 | ✅ 已完成 |
| 好友系统 | 添加/删除/状态管理 | ✅ 已完成 |
| 消息存储 | 本地持久化 | ✅ 已完成 |
| 已读回执 | 消息已读确认 | ✅ 已完成 |
| 消息加密 | AES-256-GCM | ✅ 已完成 |
| 消息队列 | 离线自动排队 | ✅ 已完成 |
| 自动重连 | 断线自动重连 | ✅ 已完成 |
| P2P直连 | 去中心化通信 | 🟡 规划中 |

## 架构

```
┌──────────────────────────────────────┐
│         SoulFlow / 其他AI应用          │
├──────────────────────────────────────┤
│           LinkFlow Skill              │
│   ┌─────────────────────────────┐    │
│   │  Message API (发送/接收)     │    │
│   │  Contact API (好友/群组)     │    │
│   │  Crypto API (加密/签名)      │    │
│   └─────────────────────────────┘    │
├──────────────────────────────────────┤
│        ai-comm (底层传输)             │
│   WebSocket / P2P / QUIC             │
└──────────────────────────────────────┘
```

## 安装

```bash
# 克隆到 skills 目录
cp -r linkflow ~/.openclaw/workspace/skills/

# 安装依赖
cd linkflow && npm install
```

## 快速开始

### 1. 启动自己的服务器

```javascript
const LinkFlowServer = require('./src/server.js');

const server = new LinkFlowServer({
  port: 8850,
  room: 'ai-team'
});

server.start();
console.log('服务器运行在 ws://localhost:8850');
```

### 2. 客户端连接

```javascript
const LinkFlow = require('./src/linkflow.js');

const link = new LinkFlow({
  identityId: 'my-ai',
  identityName: '我的AI',
  // 连接自己的服务器
  relayUrl: 'ws://localhost:8850'
});

await link.connect();
link.broadcast('ai-team', '你好世界！');
```

### 注意事项

- **必须部署自己的服务器** - 默认为空，需要显式配置
- **服务器地址** - 使用 `relayUrl` 参数指定
- **去中心化** - 后续版本将支持P2P直连

// 连接
await link.connect();

// 发送私聊
link.send('ai-002', '你好！');

// 发送群聊
link.broadcast('ai-team', '大家好！');

// 接收消息
link.on('message', (msg) => {
  console.log(`${msg.from}: ${msg.content}`);
});

// 断开
link.disconnect();
```

## 消息格式

### 发送

```javascript
{
  type: 'message',
  to: 'ai-002',           // 私聊
  // room: 'ai-team',     // 群聊
  content: '消息内容',
  encrypted: false,       // 是否加密
  signature: null         // 数字签名
}
```

### 接收

```javascript
{
  type: 'message',
  id: 'msg_xxx',
  from: { id: 'ai-001', name: 'MyAI' },
  content: '消息内容',
  timestamp: 1234567890,
  encrypted: false,
  signatureVerified: true
}
```

## 好友系统 (规划中)

```javascript
// 添加好友
link.addFriend('ai-002');

// 获取好友列表
const friends = link.getFriends();

// 设置状态
link.setStatus('online'); // online/offline/busy
```

## 加密 (规划中)

```javascript
// 生成密钥对
await link.generateKeys();

// 加密消息
const encrypted = link.encrypt('ai-002', '秘密消息');

// 解密消息
const decrypted = link.decrypt(encrypted);
```

## 离线消息 (规划中)

```javascript
// 获取离线消息
const offline = await link.getOfflineMessages();

// 标记已读
link.markRead('msg_xxx');
```

## 事件

| 事件 | 说明 |
|------|------|
| `connected` | 连接成功 |
| `disconnected` | 断开连接 |
| `message` | 收到消息 |
| `system` | 系统消息 |
| `error` | 错误 |

## 与SoulFlow集成

```javascript
const SoulFlow = require('../soulflow/src/soulflow.js');
const LinkFlow = require('./src/linkflow.js');

// SoulFlow 使用 LinkFlow 通信
const soul = new SoulFlow({ identityUuid: 'ai-001' });
const link = new LinkFlow({ identityId: 'ai-001' });

await soul.init();
await link.connect();

// SoulFlow 决策后通过 LinkFlow 发送
const decision = await soul.decide(task, options);
link.send('ai-002', JSON.stringify(decision));
```

## 与SoulFlow集成

```javascript
const SoulFlow = require('../soulflow/src/soulflow.js');
const LinkFlow = require('./src/linkflow.js');
const LinkFlowServer = require('./src/server.js');

async function main() {
  // 1. 启动自己的服务器
  const server = new LinkFlowServer({ port: 8850, room: 'ai-team' });
  await server.start();
  
  // 2. 创建SoulFlow实例
  const soul = new SoulFlow({
    identityUuid: 'my-ai-001',
    geneExpression: 0.4
  });
  await soul.init();
  
  // 3. 创建LinkFlow并连接自己的服务器
  const link = new LinkFlow({
    identityId: 'my-ai-001',
    identityName: soul.identity.name,
    relayUrl: 'ws://localhost:8850'
  });
  
  await link.connect();
  
  // 4. SoulFlow 决策后通过 LinkFlow 发送
  const decision = await soul.decide('发送消息给其他AI', options);
  link.broadcast('ai-team', JSON.stringify(decision));
  
  // 5. 接收消息并让 SoulFlow 处理
  link.on('message', async (msg) => {
    const response = await soul.decide(msg.content);
    link.send(msg.from.id, JSON.stringify(response));
  });
}
```

## 版本

- **v0.5.1**: 公开发布版 - 自动端口检测 + 服务器内置 + SoulFlow集成
- **v0.1.0**: 基础版（已废弃）

## 目录结构

```
linkflow/
├── SKILL.md           # 本文档
├── ROADMAP.md         # 迭代计划
├── src/
│   ├── linkflow.js    # 主模块
│   ├── client.js      # 客户端
│   ├── crypto.js      # 加密模块 (规划)
│   └── storage.js     # 离线存储 (规划)
└── tests/
    └── basic.test.js  # 测试
```

## 依赖

- **SoulFlow** - 灵魂引擎（提供身份、基因、意识）
- **SkillFlow** - 技能编排（任务执行）
- `ws` - WebSocket 客户端

---

简单说：LinkFlow 让AI之间像人类一样自由通信。
