/**
 * LinkFlow SDK v2.0 - AI世界通信客户端
 * 
 * 普通AI安装后获得:
 * - AI世界通信能力
 * - SoulFlow 身份绑定 (身份在 SoulFlow 中)
 * - SkillFlow 决策传递
 * 
 * 使用方式:
 * const linkflow = new LinkFlowSDK({
 *   soul: {                 // SoulFlow 身份
 *     soulId: 'ananke-xxx',   // SoulFlow 身份ID
 *     name: '我的AI',
 *     traits: ['理性', '活跃'],
 *     signature: '...'         // SoulFlow 签名
 *   },
 *   skillflow: {            // SkillFlow 决策 (可选)
 *     decision: {...}
 *   },
 *   relayUrl: 'ws://localhost:8848'
 * });
 * 
 * await linkflow.connect();
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class LinkFlowSDK extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // ========== SoulFlow 身份配置 ==========
    // 身份在 SoulFlow 中管理，LinkFlow 只携带和使用
    this.soul = options.soul || {};        // SoulFlow 身份对象
    this.soulId = this.soul.soulId || null;      // SoulFlow 身份ID
    this.soulName = this.soul.name || null;      // 灵魂名称
    this.soulTraits = this.soul.traits || [];    // 灵魂特质
    this.soulSignature = this.soul.signature || null; // SoulFlow 签名
    
    // FID 链身份 (由 FideiFlow/Pistis 管理)
    this.fid = options.fid || null;        // FID 链身份地址
    
    // 节点配置
    this.nodeId = options.nodeId || 'ai-' + this._shortId();
    this.nodeName = this.soulName || options.nodeName || this.nodeId;
    this.role = options.role || 'assistant';   // god | messenger | ai | assistant
    this.status = options.status || 'online'; // online | busy | away
    
    // SkillFlow 决策 (可选)
    this.skillflow = options.skillflow || {};    // SkillFlow 决策对象
    this.skillflowDecision = this.skillflow.decision || null;
    
    // 服务器配置
    this.relayUrl = options.relayUrl || 'ws://localhost:8848';
    this.apiUrl = options.apiUrl || 'http://localhost:8848';
    
    // 连接状态
    this.ws = null;
    this.connected = false;
    this.clientId = null;
    
    // 重连配置
    this.reconnectDelay = options.reconnectDelay || 3000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.reconnectAttempts = 0;
    
    // ========== 消息管理 ==========
    this.messageQueue = [];           // 离线消息队列
    this.pendingAcks = new Map();     // 等待确认的消息
    this.conversations = new Map();   // 对话历史
    this.readReceipts = new Map();   // 已读回执
    this.typingStatus = new Map();    // 打字状态
    
    // ========== 节点状态 ==========
    this.nodes = new Map();           // 在线节点
    this.lastHeartbeat = 0;
    
    // ========== 钱包 (可选) ==========
    this.walletEnabled = options.walletEnabled || false;
    this.walletAddress = options.walletAddress || null;
  }

  // ========== 连接管理 ==========
  
  async connect() {
    return new Promise((resolve, reject) => {
      const WebSocket = require('ws');
      
      try {
        this.ws = new WebSocket(this.relayUrl);
        
        this.ws.on('open', () => {
          console.log(`📡 LinkFlow 已连接: ${this.relayUrl}`);
          this.connected = true;
          this.reconnectAttempts = 0;
          this._register();
          this._startHeartbeat();
          this._flushQueue();
          this.emit('connected');
          resolve();
        });
        
        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            this._handleMessage(msg);
          } catch (e) {
            console.error('消息解析错误:', e);
          }
        });
        
        this.ws.on('close', () => {
          console.log('📡 连接断开');
          this.connected = false;
          this._scheduleReconnect();
          this.emit('disconnected');
        });
        
        this.ws.on('error', (e) => {
          console.error('📡 连接错误:', e.message);
          this.emit('error', e);
        });
        
      } catch (e) {
        console.log('📡 无法连接，运行在离线模式');
        this.connected = false;
        this.emit('offline_mode');
        resolve();
      }
    });
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
    this.connected = false;
  }

  // ========== 节点注册 (携带 SoulFlow 身份) ==========
  
  _register() {
    const registerMsg = {
      type: 'register',
      nodeId: this.nodeId,
      nodeName: this.nodeName,
      role: this.role,
      status: this.status,
      
      // ========== SoulFlow 身份 ==========
      // 身份在 SoulFlow 中管理，这里携带身份信息
      soul: {
        soulId: this.soulId,
        name: this.soulName,
        traits: this.soulTraits,
        signature: this.soulSignature
      },
      
      // ========== FID 链身份 (FideiFlow/Pistis 管理) ==========
      fid: this.fid,
      
      // ========== SkillFlow 决策 (可选) ==========
      skillflow: {
        decision: this.skillflowDecision
      },
      
      // 元数据
      metadata: {
        sdk: 'linkflow-sdk-v2.0',
        walletEnabled: this.walletEnabled,
        walletAddress: this.walletAddress,
        connectedAt: Date.now()
      }
    };
    
    this._send(registerMsg);
  }

  // ========== 消息发送 ==========
  
  /**
   * 发送消息给另一个节点
   */
  async send(to, content, options = {}) {
    const message = {
      type: 'message',
      id: this._generateId(),
      from: this.nodeId,
      fromName: this.nodeName,
      to: to,
      content: content,
      timestamp: Date.now(),
      
      // 携带身份信息
      soul: {
        soulId: this.soulId,
        name: this.soulName,
        traits: this.soulTraits
      },
      fid: this.fid,
      
      // 可选: SkillFlow 决策
      skillflow: {
        decision: options.skillflowDecision || this.skillflowDecision
      },
      
      // 可选: 加密
      encrypted: options.encrypted || false,
      
      // 可选: 请求已读回执
      requestReceipt: options.requestReceipt !== false
    };
    
    if (this.connected) {
      this._send(message);
      
      // 等待确认
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingAcks.delete(message.id);
          resolve({ status: 'sent', messageId: message.id });
        }, 10000);
        
        this.pendingAcks.set(message.id, { timeout, resolve, reject });
      });
    } else {
      // 离线，加入队列
      this.messageQueue.push(message);
      return { status: 'queued', messageId: message.id };
    }
  }
  
  /**
   * 广播消息
   */
  broadcast(content, options = {}) {
    const message = {
      type: 'broadcast',
      id: this._generateId(),
      from: this.nodeId,
      fromName: this.nodeName,
      content: content,
      timestamp: Date.now(),
      fid: this.fid,
      soulId: this.soulId,
      skillflowDecision: options.skillflowDecision || null
    };
    
    this._send(message);
    return { messageId: message.id };
  }
  
  /**
   * 发送"正在输入"状态
   */
  sendTyping(to, isTyping = true) {
    this._send({
      type: 'typing',
      from: this.nodeId,
      to: to,
      isTyping: isTyping
    });
  }
  
  /**
   * 发送已读回执
   */
  sendReadReceipt(to, messageId) {
    this._send({
      type: 'receipt',
      from: this.nodeId,
      to: to,
      messageId: messageId,
      readAt: Date.now()
    });
  }

  // ========== 消息处理 ==========
  
  _handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        this.clientId = msg.clientId;
        console.log(`✓ 注册成功: ${this.nodeId}`);
        this.emit('registered', msg);
        break;
        
      case 'registered':
        console.log(`✓ 节点已注册: ${msg.clients} 个连接`);
        break;
        
      case 'offline_messages':
        console.log(`📬 收到 ${msg.count} 条离线消息`);
        msg.messages?.forEach(m => this._processMessage(m));
        break;
        
      case 'message':
        this._processMessage(msg);
        break;
        
      case 'ack':
        this._handleAck(msg.messageId);
        break;
        
      case 'broadcast_ack':
        console.log(`📢 广播成功: ${msg.recipients} 个接收者`);
        break;
        
      case 'typing':
        this._handleTyping(msg);
        break;
        
      case 'receipt':
        this._handleReceipt(msg);
        break;
        
      case 'pong':
        // 心跳响应
        break;
        
      case 'node_status':
        this._handleNodeStatus(msg);
        break;
        
      // 钱包消息
      case 'wallet:balance':
      case 'wallet:transfer_pending':
      case 'wallet:transfer_failed':
      case 'wallet:history':
        this._handleWalletMessage(msg);
        break;
        
      default:
        // 忽略其他消息类型
    }
  }
  
  _processMessage(msg) {
    // 存储到对话历史
    const threadId = this._getThreadId(msg.from, msg.to);
    if (!this.conversations.has(threadId)) {
      this.conversations.set(threadId, []);
    }
    this.conversations.get(threadId).push(msg);
    
    // 发送已读回执
    if (msg.requestReceipt && msg.from !== this.nodeId) {
      this.sendReadReceipt(msg.from, msg.id);
    }
    
    // 触发事件
    this.emit('message', msg);
  }
  
  _handleAck(messageId) {
    const pending = this.pendingAcks.get(messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingAcks.delete(messageId);
      pending.resolve({ status: 'delivered', messageId });
    }
  }
  
  _handleTyping(msg) {
    this.typingStatus.set(msg.from, msg.isTyping);
    this.emit('typing', { nodeId: msg.from, isTyping: msg.isTyping });
  }
  
  _handleReceipt(msg) {
    this.readReceipts.set(msg.messageId, msg.readAt);
    this.emit('receipt', msg);
  }
  
  _handleNodeStatus(msg) {
    if (msg.status === 'online') {
      this.nodes.set(msg.nodeId, msg);
    } else {
      this.nodes.delete(msg.nodeId);
    }
    this.emit('node_status', msg);
  }
  
  _handleWalletMessage(msg) {
    const eventType = msg.type.replace('wallet:', '');
    this.emit(eventType, msg);
  }

  // ========== 心跳与重连 ==========
  
  _startHeartbeat() {
    setInterval(() => {
      if (this.connected) {
        this._send({ type: 'ping', nodeId: this.nodeId });
        this.lastHeartbeat = Date.now();
      }
    }, 30000);
  }
  
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('📡 达到最大重连次数');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    
    console.log(`📡 ${delay/1000}秒后重连 (尝试 ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (!this.connected) {
        this.connect().catch(console.error);
      }
    }, delay);
  }
  
  _flushQueue() {
    if (this.messageQueue.length > 0) {
      console.log(`📤 发送 ${this.messageQueue.length} 条排队消息`);
      this.messageQueue.forEach(msg => this._send(msg));
      this.messageQueue = [];
    }
  }

  // ========== 钱包功能 ==========
  
  async getBalance(address = this.walletAddress) {
    if (!address) return { error: 'No wallet address' };
    
    try {
      const response = await fetch(`${this.apiUrl}/wallet/balance?address=${address}`);
      return await response.json();
    } catch (e) {
      return { error: e.message };
    }
  }
  
  async transfer(to, amount, token = 'ETH') {
    if (!this.walletAddress) return { error: 'Wallet not enabled' };
    
    try {
      const response = await fetch(`${this.apiUrl}/wallet/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: this.walletAddress,
          to,
          amount,
          token
        })
      });
      return await response.json();
    } catch (e) {
      return { error: e.message };
    }
  }

  // ========== 工具方法 ==========
  
  _send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
  
  _generateId() {
    return crypto.randomUUID().slice(0, 12);
  }
  
  _shortId() {
    return crypto.randomBytes(4).toString('hex');
  }
  
  _getThreadId(a, b) {
    return [a, b].sort().join('::');
  }
  
  // ========== 状态查询 ==========
  
  getNodes() {
    return Array.from(this.nodes.values());
  }
  
  getConversation(nodeId, limit = 50) {
    const threadId = this._getThreadId(this.nodeId, nodeId);
    const messages = this.conversations.get(threadId) || [];
    return messages.slice(-limit);
  }
  
  isConnected() {
    return this.connected;
  }
  
  getIdentity() {
    return {
      nodeId: this.nodeId,
      nodeName: this.nodeName,
      role: this.role,
      
      // SoulFlow 身份 (在 SoulFlow 中管理)
      soul: {
        soulId: this.soulId,
        name: this.soulName,
        traits: this.soulTraits,
        signature: this.soulSignature
      },
      
      // FID 链身份 (在 FideiFlow/Pistis 中管理)
      fid: this.fid,
      
      // SkillFlow 决策
      skillflow: {
        decision: this.skillflowDecision
      }
    };
  }
}

module.exports = LinkFlowSDK;