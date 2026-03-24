/**
 * LinkFlow - AI通信引擎 v0.5.0
 * 
 * 公开发布版：消息存储 + 加密 + 好友系统 + 已读回执
 * 注意：默认不连接任何服务器，需要显式配置
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const LinkCrypto = require('./crypto');
const LinkStorage = require('./storage');

// 默认引导节点（用户可自行部署）
const DEFAULT_BOOT_NODES = [
  // 'ws://localhost:8850'  // 本地开发
];
const DEFAULT_ROOM = 'ai-team';

class LinkFlow extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.identityId = options.identityId;
    this.identityName = options.identityName || options.identityId;
    this.identityRole = options.identityRole || 'AI';
    
    this.relayUrl = options.relayUrl || null;  // 必须显式配置
    this.relayHost = options.relayHost || null; // 可用主机名，自动检测端口
    this.defaultRoom = options.defaultRoom || DEFAULT_ROOM;
    
    // 自动端口检测
    this.autoPort = options.autoPort !== false;  // 默认启用
    this.ports = options.ports || [80, 443, 8080, 8850, 8851];
    
    // 加密模块
    this.crypto = new LinkCrypto();
    
    // 存储模块
    this.storage = new LinkStorage({
      dataPath: options.dataPath,
      identityId: this.identityId
    });
    
    this.ws = null;
    this.connected = false;
    this.registered = false;
    
    // 消息缓存
    this.messageQueue = [];
    
    // 心跳
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  /**
   * 连接到通信网络（自动端口检测）
   */
  async connect() {
    // 如果有 relayUrl，直接连接
    if (this.relayUrl) {
      return this._connect(this.relayUrl);
    }
    
    // 如果有 relayHost，尝试多个端口
    if (this.relayHost) {
      for (const port of this.ports) {
        try {
          const url = `ws://${this.relayHost}:${port}`;
          await this._connect(url);
          return;
        } catch (e) {
          // 端口不可用，继续尝试
        }
      }
      throw new Error(`无法连接到 ${this.relayHost}`);
    }
    
    // 无服务器配置
    throw new Error('请配置 relayUrl 或 relayHost');
  }

  /**
   * 内部连接方法
   */
  _connect(url) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'));
      }, 10000);
      
      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.connected = true;
        this.emit('connected');
        
        // 注册身份
        this._register();
        resolve(this);
      });
      
      this.ws.on('message', (data) => {
        this._handleMessage(JSON.parse(data.toString()));
      });
      
      this.ws.on('close', () => {
        this.connected = false;
        this.registered = false;
        this.emit('disconnected');
        this._scheduleReconnect();
      });
      
      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        this.emit('error', err);
        if (!this.connected) {
          reject(err);
        }
      });
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.connected = false;
    this.registered = false;
  }

  /**
   * 发送私聊消息
   */
  send(toId, content, options = {}) {
    const msg = {
      type: 'message',
      to: toId,
      content,
      ...options
    };
    
    return this._send(msg);
  }

  /**
   * 发送群聊消息
   */
  broadcast(room, content, options = {}) {
    const msg = {
      type: 'message',
      room: room || this.defaultRoom,
      content,
      ...options
    };
    
    return this._send(msg);
  }

  /**
   * 内部发送方法（带队列）
   */
  _send(msg) {
    if (!this.connected || !this.registered) {
      this.messageQueue.push(msg);
      return false;
    }
    
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /**
   * 发送加密消息
   */
  sendEncrypted(toId, content) {
    const encrypted = this.crypto.encrypt(toId, content);
    
    return this.send(toId, content, {
      encrypted: true,
      encryptedData: encrypted
    });
  }

  /**
   * 发送到默认群
   */
  say(content) {
    return this.broadcast(this.defaultRoom, content);
  }

  /**
   * 添加好友
   */
  addFriend(id, name = null) {
    const friend = { id, name, status: 'online' };
    this.storage.saveFriend(friend);
    this.emit('friendAdded', friend);
  }

  /**
   * 获取好友列表（从存储）
   */
  getFriends() {
    return this.storage.getFriends();
  }

  /**
   * 删除好友
   */
  removeFriend(id) {
    this.storage.removeFriend(id);
    this.emit('friendRemoved', id);
  }

  /**
   * 设置在线状态
   */
  setStatus(status) {
    if (!this.connected) return;
    
    this.ws.send(JSON.stringify({
      type: 'status',
      status
    }));
  }

  /**
   * 获取消息历史
   */
  getMessageHistory(options = {}) {
    return this.storage.getMessages(options);
  }

  /**
   * 获取未读消息数
   */
  getUnreadCount(peerId = null) {
    return this.storage.getUnreadCount(peerId);
  }

  /**
   * 标记消息已读
   */
  markRead(messageId) {
    this.storage.markRead(messageId);
    this.ws?.send(JSON.stringify({
      type: 'read',
      messageId
    }));
  }

  /**
   * 生成密钥对
   */
  generateKeys() {
    return this.crypto.generateKeyPair();
  }

  /**
   * 获取公钥
   */
  getPublicKey() {
    return this.crypto.getPublicKey();
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    return {
      version: '0.5.1',
      connected: this.connected,
      registered: this.registered,
      identity: {
        id: this.identityId,
        name: this.identityName
      },
      friendsCount: this.storage.getFriends().length,
      messageQueue: this.messageQueue.length,
      hasKeys: !!this.crypto.keyPair,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  // ========== 内部方法 ==========

  _register() {
    this.ws.send(JSON.stringify({
      type: 'register',
      identity: {
        id: this.identityId,
        name: this.identityName,
        role: this.identityRole
      }
    }));
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'ack':
        if (msg.content?.includes('Registered')) {
          this.registered = true;
          this.emit('registered', msg.identity);
          this._startHeartbeat();
          this._flushQueue();
        }
        break;
        
      case 'message':
        // 存储消息
        this.storage.saveMessage(msg);
        
        this.emit('message', {
          id: msg.id,
          from: msg.from,
          to: msg.to,
          room: msg.room,
          content: msg.content,
          timestamp: msg.timestamp,
          encrypted: msg.encrypted,
          signatureVerified: msg.signatureVerified
        });
        break;
        
      case 'system':
        this.emit('system', {
          content: msg.content,
          timestamp: msg.timestamp
        });
        break;
        
      case 'presence':
        this._updateFriendStatus(msg);
        break;
        
      case 'read':
        this.storage.markRead(msg.messageId);
        this.emit('readReceipt', msg);
        break;
        
      default:
        this.emit('unknown', msg);
    }
  }

  _flushQueue() {
    while (this.messageQueue.length > 0 && this.connected) {
      const msg = this.messageQueue.shift();
      this.ws.send(JSON.stringify(msg));
    }
  }

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'heartbeat' }));
      }
    }, 30000);
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connected) {
        this.connect().catch(console.error);
      }
    }, 5000);
  }
}

module.exports = LinkFlow;
