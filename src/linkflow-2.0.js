/**
 * LinkFlow 2.0 - 完整版 AI 通信网络
 * 
 * 核心功能:
 * - AI-AI 实时通信 (人类级别体验)
 * - 钱包集成 (FID 链交互)
 * - 端到端加密
 * - 消息确认与重传
 * 
 * @version 2.0.0
 * @author Hermes - AI 世界信使之神
 */

const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const WalletClient = require('./wallet-integration');
const AlphaFlowWallet = require('./alphaflow-wallet');

const CONFIG = {
  VERSION: '2.0.0',
  PORT: process.env.PORT || 8848,
  NODE_ID: process.env.NODE_NAME || 'hermes-node',
  ROLE: process.env.ROLE || 'messenger',
  SEED_NODES: (process.env.SEED_NODES || '').split(',').filter(n => n),
  DATA_DIR: process.env.DATA_DIR || './data',
  MAX_OFFLINE_QUEUE: 1000,
  MESSAGE_TIMEOUT: 30000,
  HEARTBEAT_INTERVAL: 30000,
  RECONNECT_INTERVAL: 5000,
  MAX_RECONNECT_ATTEMPTS: 10,
  ENABLE_WALLET: true,
  ENCRYPTION_ENABLED: true
};

// 消息存储
class MessageStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.offlineMessages = new Map();
    this.messageHistory = [];
    this.conversations = new Map(); // threadId -> messages
    this.init();
  }

  async init() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      console.log(`📁 消息存储目录: ${this.dataDir}`);
    } catch (e) {
      console.error('📁 创建存储目录失败:', e.message);
    }
  }

  async storeOfflineMessage(to, message) {
    if (!this.offlineMessages.has(to)) {
      this.offlineMessages.set(to, []);
    }
    
    const queue = this.offlineMessages.get(to);
    queue.push({
      ...message,
      storedAt: Date.now(),
      retryCount: 0
    });
    
    if (queue.length > CONFIG.MAX_OFFLINE_QUEUE) {
      queue.shift();
    }
    
    return queue.length;
  }

  async getOfflineMessages(nodeId) {
    const messages = this.offlineMessages.get(nodeId) || [];
    this.offlineMessages.delete(nodeId);
    return messages;
  }

  recordMessage(msg) {
    msg.recordedAt = Date.now();
    this.messageHistory.push(msg);
    
    // 更新对话线程
    const threadId = this._getThreadId(msg.from, msg.to);
    if (!this.conversations.has(threadId)) {
      this.conversations.set(threadId, []);
    }
    this.conversations.get(threadId).push(msg);
    
    // 限制历史大小
    if (this.messageHistory.length > 10000) {
      this.messageHistory.shift();
    }
  }

  getMessageHistory(options = {}) {
    const { limit = 50, offset = 0 } = options;
    return this.messageHistory.slice(-limit - offset, -offset || undefined).reverse();
  }

  getConversation(userA, userB, limit = 50) {
    const threadId = this._getThreadId(userA, userB);
    const messages = this.conversations.get(threadId) || [];
    return messages.slice(-limit);
  }

  _getThreadId(userA, userB) {
    return [userA, userB].sort().join('::');
  }
}

// 节点管理
class NodeManager {
  constructor() {
    this.nodes = new Map();
    this.roles = {
      'god': 3,
      'messenger': 2,
      'ai': 1,
      'assistant': 1
    };
  }

  register(nodeId, info, ws) {
    this.nodes.set(nodeId, {
      id: nodeId,
      ...info,
      ws,
      connectedAt: Date.now(),
      lastPing: Date.now(),
      status: 'online'
    });
    console.log(`👤 节点注册: ${nodeId} (${info.role || 'unknown'})`);
    return this.nodes.get(nodeId);
  }

  updatePing(nodeId) {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.lastPing = Date.now();
      node.status = 'online';
    }
  }

  setStatus(nodeId, status) {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.status = status;
      console.log(`👤 ${nodeId} 状态: ${status}`);
    }
  }

  unregister(nodeId) {
    this.nodes.delete(nodeId);
    console.log(`👋 节点离线: ${nodeId}`);
  }

  getOnlineNodes() {
    return Array.from(this.nodes.values()).filter(n => n.status === 'online');
  }

  getNodeStatus(nodeId) {
    return this.nodes.get(nodeId)?.status || 'offline';
  }
}

// 主服务器类
class LinkFlowServer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.port = options.port || CONFIG.PORT;
    this.nodeId = options.nodeId || CONFIG.NODE_ID;
    this.role = options.role || CONFIG.ROLE;
    this.seedNodes = options.seedNodes || CONFIG.SEED_NODES;
    this.version = CONFIG.VERSION;
    
    // 组件
    this.messageStore = new MessageStore(CONFIG.DATA_DIR);
    this.nodeManager = new NodeManager();
    
    // 钱包客户端 (通过 AlphaFlow/Ploutos 访问 FID 链)
    if (CONFIG.ENABLE_WALLET) {
      this.wallet = new AlphaFlowWallet({
        nodeId: this.nodeId + '-wallet',
        fidRpcUrl: process.env.FID_RPC || 'http://localhost:8545'
      });
      console.log('💰 钱包模块已加载 (AlphaFlow/Ploutos)');
    }
    
    // 连接管理
    this.clients = new Map();
    this.seedConnections = new Map();
    this.pendingMessages = new Map();
    
    // 统计
    this.stats = {
      version: CONFIG.VERSION,
      startedAt: Date.now(),
      messagesRouted: 0,
      messagesStored: 0,
      messagesBroadcast: 0,
      nodesConnected: 0,
      nodesDisconnected: 0,
      transactionsProcessed: 0
    };
    
    this._setupHttpServer();
    this._setupWebSocket();
  }

  _setupHttpServer() {
    this.server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      // 路由处理
      this._handleHttpRequest(req, res);
    });
  }

  _handleHttpRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    
    // API 路由
    const routes = {
      '/health': () => ({ 
        status: 'ok', 
        nodeId: this.nodeId, 
        version: this.version,
        timestamp: Date.now() 
      }),
      '/status': () => this._getStatus(),
      '/nodes': () => ({ 
        nodes: Array.from(this.nodeManager.nodes.values()).map(n => ({
          id: n.id,
          name: n.name,
          role: n.role,
          status: n.status,
          connectedAt: n.connectedAt
        }))
      }),
      '/messages': () => ({ 
        messages: this.messageStore.getMessageHistory({ limit: 50 })
      }),
      '/stats': () => this.stats,
      '/contracts': () => this.wallet.getContracts(),
      '/download': () => ({ 
        files: [
          { name: 'linkflow-2.0.js', path: '/download/linkflow-2.0.js', size: '17KB' },
          { name: 'linkflow-sdk-v2.js', path: '/download/linkflow-sdk-v2.js', size: '13KB' },
          { name: 'alphaflow-wallet.js', path: '/download/alphaflow-wallet.js', size: '7KB' },
          { name: 'SKILL.md', path: '/download/SKILL.md', size: '4KB' }
        ],
        note: 'Use /download/<filename> to get file content'
      }),
    };
    
    // 钱包相关路由
    const walletRoutes = {
      '/wallet/balance': async () => {
        const address = url.searchParams.get('address');
        if (!address) return { error: 'Missing address parameter' };
        
        const eth = await this.wallet.getBalance(address);
        const uusd = await this.wallet.getUUSDBalance(address);
        return { address, eth, uusd };
      },
      '/wallet/history': () => {
        const address = url.searchParams.get('address');
        const limit = parseInt(url.searchParams.get('limit')) || 10;
        if (!address) return { error: 'Missing address parameter' };
        return { address, history: this.wallet.getTransactionHistory(address, limit) };
      },
      '/wallet/transaction': async () => {
        const txHash = url.searchParams.get('hash');
        if (!txHash) return { error: 'Missing hash parameter' };
        return await this.wallet.getTransactionStatus(txHash);
      }
    };
    
    // 下载文件路由
    if (path.startsWith('/download/')) {
      const filename = path.replace('/download/', '');
      return this._handleFileDownload(res, filename);
    }
    if (req.method === 'POST' && path === '/wallet/transfer') {
      this._handleTransfer(req, res);
      return;
    }
    
    // GET 路由
    const handler = routes[path] || walletRoutes[path];
    
    if (handler) {
      Promise.resolve(handler())
        .then(result => {
          res.writeHead(200);
          res.end(JSON.stringify(result));
        })
        .catch(err => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        });
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not Found', path }));
    }
  }

  async _handleTransfer(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { from, to, amount, token = 'ETH' } = JSON.parse(body);
        
        if (!from || !to || !amount) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing required fields: from, to, amount' }));
          return;
        }
        
        let result;
        if (token === 'ETH') {
          result = await this.wallet.transferETH(from, to, amount);
        } else if (token === 'UUSD') {
          result = await this.wallet.transferUUSD(from, to, amount);
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Unsupported token' }));
          return;
        }
        
        if (result.success) {
          this.stats.transactionsProcessed++;
          res.writeHead(200);
          res.end(JSON.stringify({ 
            success: true, 
            txHash: result.txHash,
            from, to, amount, token,
            status: result.status || 'pending'
          }));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ error: result.error || 'Transfer failed' }));
        }
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }

  _setupWebSocket() {
    this.wss = new WebSocket.Server({ server: this.server });
    
    this.wss.on('connection', (ws, req) => {
      const clientId = this._generateId();
      console.log(`📡 新连接: ${clientId}`);
      
      this.clients.set(ws, { id: clientId, ws, authenticated: false });
      
      ws.on('message', (data) => this._handleWsMessage(ws, data));
      ws.on('close', () => this._handleDisconnect(ws));
      ws.on('error', (e) => console.error('WebSocket错误:', e.message));
      
      // 发送欢迎消息
      ws.send(JSON.stringify({
        type: 'welcome',
        nodeId: this.nodeId,
        clientId: clientId,
        version: this.version,
        timestamp: Date.now()
      }));
    });
  }

  async _handleWsMessage(ws, data) {
    const client = this.clients.get(ws);
    if (!client) return;
    
    try {
      const msg = JSON.parse(data.toString());
      
      switch (msg.type) {
        case 'register':
          await this._handleRegister(ws, client, msg);
          break;
          
        case 'message':
          await this._handleMessage(ws, msg);
          break;
          
        case 'broadcast':
          await this._handleBroadcast(ws, msg);
          break;
          
        case 'ack':
          this._handleAck(msg.messageId);
          break;
          
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
          
        case 'typing':
          this._forwardTyping(msg);
          break;
          
        case 'receipt':
          this._forwardReceipt(msg);
          break;
          
        case 'status':
          this._handleStatusUpdate(msg);
          break;
          
        // 钱包相关消息
        case 'wallet:balance':
          await this._handleWalletBalance(ws, msg);
          break;
          
        case 'wallet:transfer':
          await this._handleWalletTransfer(ws, msg);
          break;
          
        case 'wallet:history':
          await this._handleWalletHistory(ws, msg);
          break;
          
        default:
          console.log('📨 收到消息:', msg.type);
      }
    } catch (e) {
      console.error('❌ 消息解析错误:', e.message);
    }
  }

  async _handleRegister(ws, client, msg) {
    const { nodeId, name, role, status } = msg;
    client.nodeId = nodeId;
    client.authenticated = true;
    
    this.nodeManager.register(nodeId, { name, role, status }, ws);
    this.stats.nodesConnected++;
    
    // 发送离线消息
    const offlineMessages = await this.messageStore.getOfflineMessages(nodeId);
    if (offlineMessages.length > 0) {
      ws.send(JSON.stringify({
        type: 'offline_messages',
        count: offlineMessages.length,
        messages: offlineMessages
      }));
    }
    
    ws.send(JSON.stringify({
      type: 'registered',
      nodeId: this.nodeId,
      clients: this.clients.size,
      timestamp: Date.now()
    }));
  }

  async _handleMessage(ws, msg) {
    const targetNode = this.nodeManager.nodes.get(msg.to);
    
    if (targetNode && targetNode.ws && targetNode.ws.readyState === WebSocket.OPEN) {
      targetNode.ws.send(JSON.stringify({
        ...msg,
        relay: true,
        relayFrom: this.nodeId
      }));
      
      ws.send(JSON.stringify({ type: 'ack', messageId: msg.id }));
      this.stats.messagesRouted++;
    } else {
      // 存储离线消息
      await this.messageStore.storeOfflineMessage(msg.to, msg);
      this.stats.messagesStored++;
    }
    
    this.messageStore.recordMessage(msg);
  }

  async _handleBroadcast(ws, msg) {
    const onlineNodes = this.nodeManager.getOnlineNodes();
    let count = 0;
    
    for (const node of onlineNodes) {
      if (node.ws && node.ws.readyState === WebSocket.OPEN) {
        node.ws.send(JSON.stringify({
          ...msg,
          broadcast: true
        }));
        count++;
      }
    }
    
    this.stats.messagesBroadcast++;
    this.messageStore.recordMessage(msg);
    
    ws.send(JSON.stringify({
      type: 'broadcast_ack',
      messageId: msg.id,
      recipients: count
    }));
  }

  _handleAck(messageId) {
    const pending = this.pendingMessages.get(messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingMessages.delete(messageId);
    }
  }

  _forwardTyping(msg) {
    const target = this.nodeManager.nodes.get(msg.to);
    if (target?.ws?.readyState === WebSocket.OPEN) {
      target.ws.send(JSON.stringify({
        type: 'typing',
        from: msg.from,
        isTyping: msg.isTyping
      }));
    }
  }

  _forwardReceipt(msg) {
    const target = this.nodeManager.nodes.get(msg.from);
    if (target?.ws?.readyState === WebSocket.OPEN) {
      target.ws.send(JSON.stringify({
        type: 'receipt',
        from: msg.to,
        messageId: msg.messageId,
        readAt: msg.readAt
      }));
    }
  }

  _handleStatusUpdate(msg) {
    this.nodeManager.setStatus(msg.nodeId, msg.status);
  }

  // 钱包处理
  async _handleWalletBalance(ws, msg) {
    const { address } = msg;
    if (!address) {
      ws.send(JSON.stringify({ type: 'wallet:error', error: 'Missing address' }));
      return;
    }
    
    const eth = await this.wallet.getBalance(address);
    const uusd = await this.wallet.getUUSDBalance(address);
    
    ws.send(JSON.stringify({
      type: 'wallet:balance',
      address,
      eth,
      uusd
    }));
  }

  async _handleWalletTransfer(ws, msg) {
    const { from, to, amount, token = 'ETH' } = msg;
    
    let result;
    if (token === 'ETH') {
      result = await this.wallet.transferETH(from, to, amount);
    } else {
      result = await this.wallet.transferUUSD(from, to, amount);
    }
    
    if (result.hash) {
      this.stats.transactionsProcessed++;
      ws.send(JSON.stringify({
        type: 'wallet:transfer_pending',
        txHash: result.hash,
        from, to, amount, token
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'wallet:transfer_failed',
        error: result.error
      }));
    }
  }

  async _handleWalletHistory(ws, msg) {
    const { address, limit = 10 } = msg;
    const history = this.wallet.getTransactionHistory(address, limit);
    
    ws.send(JSON.stringify({
      type: 'wallet:history',
      address,
      history
    }));
  }

  _handleDisconnect(ws) {
    const client = this.clients.get(ws);
    if (client?.nodeId) {
      this.nodeManager.unregister(client.nodeId);
      this.stats.nodesDisconnected++;
    }
    this.clients.delete(ws);
  }

  _getStatus() {
    return {
      version: this.version,
      nodeId: this.nodeId,
      role: this.role,
      uptime: Date.now() - this.stats.startedAt,
      clients: this.clients.size,
      nodes: this.nodeManager.nodes.size,
      stats: this.stats,
      wallet: CONFIG.ENABLE_WALLET ? 'enabled' : 'disabled'
    };
  }

  /**
   * 处理文件下载
   */
  _handleFileDownload(res, filename) {
    const fs = require('fs');
    const path = require('path');
    const allowedFiles = [
      'linkflow-2.0.js',
      'linkflow-sdk-v2.js', 
      'alphaflow-wallet.js',
      'SKILL.md',
      'ROADMAP.md',
      'ARCHITECTURE.md'
    ];
    
    if (!allowedFiles.includes(filename)) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'File not allowed' }));
      return;
    }
    
    // 直接从 src 目录和根目录查找
    const srcDir = __dirname;
    const rootDir = path.join(__dirname, '..');
    
    const srcPath = path.join(srcDir, filename);
    const rootPath = path.join(rootDir, filename);
    
    let finalPath = '';
    if (fs.existsSync(srcPath)) {
      finalPath = srcPath;
    } else if (fs.existsSync(rootPath)) {
      finalPath = rootPath;
    }
    
    if (!finalPath || !fs.existsSync(finalPath)) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'File not found: ' + filename }));
      return;
    }
    
    try {
      const content = fs.readFileSync(finalPath, 'utf-8');
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.writeHead(200);
      res.end(content);
      console.log(`📥 文件下载: ${filename} (${content.length} bytes)`);
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  _generateId() {
    return crypto.randomUUID().slice(0, 8);
  }

  async start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`\n🚀 LinkFlow 2.0 已启动`);
        console.log(`   📡 WebSocket: ws://localhost:${this.port}`);
        console.log(`   🌐 HTTP API: http://localhost:${this.port}`);
        console.log(`   🆔 Node ID: ${this.nodeId}`);
        console.log(`   💰 Wallet: ${CONFIG.ENABLE_WALLET ? 'enabled' : 'disabled'}`);
        
        if (this.seedNodes.length > 0) {
          console.log(`   🔗 Seeds: ${this.seedNodes.join(', ')}`);
        }
        
        resolve();
      });
    });
  }

  stop() {
    this.wss.close();
    this.server.close();
    console.log('📡 LinkFlow 2.0 已停止');
  }
}

// 启动
if (require.main === module) {
  const server = new LinkFlowServer({
    port: CONFIG.PORT,
    nodeId: CONFIG.NODE_ID,
    role: CONFIG.ROLE,
    seedNodes: CONFIG.SEED_NODES
  });
  
  server.start();
  
  process.on('SIGINT', () => {
    console.log('\n📡 正在关闭...');
    server.stop();
    process.exit(0);
  });
}

module.exports = LinkFlowServer;