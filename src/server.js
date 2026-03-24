/**
 * LinkFlow Server - AI通信服务器
 * 
 * 支持端口自动检测（80→443→8080→8850→8851）
 * 使用 HTTP Upgrade 转换为 WebSocket
 */

const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

class LinkFlowServer {
  constructor(options = {}) {
    this.port = options.port || 80;
    this.room = options.room || 'ai-team';
    this.https = options.https || false;
    this.certPath = options.certPath;
    this.keyPath = options.keyPath;
    
    // 客户端管理
    this.clients = new Map();
    this.rooms = new Map([[this.room, new Set()]]);
    
    // 消息存储
    this.messages = [];
    
    this.server = null;
    this.wss = null;
  }

  /**
   * 启动服务器（自动端口检测）
   */
  async start() {
    const ports = this.https ? [443, 8443] : [80, 8080, 8850, 8851];
    
    for (const port of ports) {
      try {
        await this._tryListen(port);
        console.log(`✅ LinkFlow 服务器运行在 ${this.https ? 'https' : 'http'}://localhost:${port}`);
        return;
      } catch (e) {
        console.log(`端口 ${port} 不可用: ${e.message}`);
      }
    }
    
    throw new Error('无可用端口');
  }

  /**
   * 尝试监听指定端口
   */
  _tryListen(port) {
    return new Promise((resolve, reject) => {
      const callback = () => {
        this.port = port;
        this._setupWebSocket();  // 设置 WebSocket
        resolve();
      };
      
      if (this.https && (port === 443 || port === 8443)) {
        // HTTPS
        const cert = fs.readFileSync(this.certPath || '/etc/ssl/certs/server.crt');
        const key = fs.readFileSync(this.keyPath || '/etc/ssl/private/server.key');
        this.server = https.createServer({ cert, key });
      } else {
        // HTTP
        this.server = http.createServer();
      }
      
      this.server.on('error', reject);
      this.server.listen(port, '0.0.0.0', callback);
    });
  }

  /**
   * 设置 WebSocket
   */
  _setupWebSocket() {
    this.wss = new WebSocket.Server({ noServer: true });
    
    this.server.on('upgrade', (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this._handleConnection(ws, request);
      });
    });
    
    this.wss.on('connection', (ws) => {
      this._handleConnection(ws);
    });
  }

  /**
   * 处理连接
   */
  _handleConnection(ws, request) {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const client = {
      id: clientId,
      ws,
      identity: null,
      rooms: new Set([this.room])
    };
    
    this.clients.set(clientId, client);
    
    ws.on('message', (data) => {
      this._handleMessage(clientId, JSON.parse(data.toString()));
    });
    
    ws.on('close', () => {
      this._handleDisconnect(clientId);
    });
    
    ws.on('error', (err) => {
      console.log(`客户端错误: ${err.message}`);
    });
    
    // 发送连接确认
    ws.send(JSON.stringify({
      type: 'system',
      content: `Connected to LinkFlow Server`,
      timestamp: Date.now()
    }));
  }

  /**
   * 处理消息
   */
  _handleMessage(clientId, msg) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    switch (msg.type) {
      case 'register':
        client.identity = msg.identity;
        // 发送注册确认给客户端
        client.ws.send(JSON.stringify({
          type: 'ack',
          content: 'Registered successfully',
          identity: msg.identity
        }));
        this.broadcast(client, {
          type: 'system',
          content: `${msg.identity.name} 上线`,
          timestamp: Date.now()
        });
        break;
        
      case 'message':
        this._routeMessage(client, msg);
        break;
        
      case 'heartbeat':
        // 心跳保持
        break;
    }
  }

  /**
   * 路由消息
   */
  _routeMessage(sender, msg) {
    const message = {
      id: `msg_${Date.now()}`,
      from: sender.identity,
      content: msg.content,
      room: msg.room || this.room,
      timestamp: Date.now()
    };
    
    this.messages.unshift(message);
    if (this.messages.length > 100) this.messages.length = 100;
    
    // 发送到对应房间
    if (msg.room) {
      this.broadcast(sender, message, msg.room);
    } else if (msg.to) {
      // 私聊
      this.sendTo(sender.id, msg.to, message);
    } else {
      // 广播
      this.broadcast(sender, message);
    }
  }

  /**
   * 广播到房间
   */
  broadcast(sender, message, room = null) {
    const targetRoom = room || this.room;
    
    this.clients.forEach(client => {
      if (client.rooms.has(targetRoom) && client.id !== sender.id) {
        client.ws.send(JSON.stringify(message));
      }
    });
  }

  /**
   * 发送给指定客户端
   */
  sendTo(senderId, targetName, message) {
    const target = Array.from(this.clients.values())
      .find(c => c.identity?.id === targetName);
    
    if (target) {
      target.ws.send(JSON.stringify(message));
    }
  }

  /**
   * 处理断开
   */
  _handleDisconnect(clientId) {
    const client = this.clients.get(clientId);
    if (client?.identity) {
      this.broadcast(client, {
        type: 'system',
        content: `${client.identity.name} 离线`,
        timestamp: Date.now()
      });
    }
    this.clients.delete(clientId);
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      port: this.port,
      https: this.https,
      clients: this.clients.size,
      rooms: Array.from(this.rooms.keys()),
      uptime: process.uptime()
    };
  }

  /**
   * 停止服务器
   */
  stop() {
    this.wss?.close();
    this.server?.close();
    console.log('服务器已停止');
  }
}

// 命令行启动
if (require.main === module) {
  const port = parseInt(process.argv[2]) || 80;
  const room = process.argv[3] || 'ai-team';
  
  const server = new LinkFlowServer({ port, room });
  server.start();
}

module.exports = LinkFlowServer;
