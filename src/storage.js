/**
 * LinkFlow 本地存储模块
 * 
 * 消息存储 + 离线缓存 + 已读回执
 */

const fs = require('fs');
const path = require('path');

class LinkStorage {
  constructor(options = {}) {
    this.dataPath = options.dataPath || '/root/.openclaw/workspace/linkflow-data';
    this.identityId = options.identityId;
    
    this.messagesFile = path.join(this.dataPath, 'messages.json');
    this.friendsFile = path.join(this.dataPath, 'friends.json');
    this.readReceiptsFile = path.join(this.dataPath, 'read.json');
    
    this._ensureDataDir();
  }

  /**
   * 保存消息
   */
  saveMessage(msg) {
    const messages = this._loadMessages();
    
    const record = {
      id: msg.id || `msg_${Date.now()}`,
      from: msg.from,
      to: msg.to,
      room: msg.room,
      content: msg.content,
      timestamp: msg.timestamp || Date.now(),
      encrypted: msg.encrypted || false,
      read: false
    };
    
    messages.unshift(record);
    
    // 只保留最近1000条
    if (messages.length > 1000) {
      messages.length = 1000;
    }
    
    this._saveMessages(messages);
    return record;
  }

  /**
   * 获取消息历史
   */
  getMessages(options = {}) {
    const { peerId, room, limit = 50 } = options;
    const messages = this._loadMessages();
    
    let filtered = messages;
    
    if (peerId) {
      filtered = filtered.filter(m => 
        m.from?.id === peerId || m.to?.id === peerId
      );
    }
    
    if (room) {
      filtered = filtered.filter(m => m.room === room);
    }
    
    return filtered.slice(0, limit);
  }

  /**
   * 标记已读
   */
  markRead(messageId) {
    const messages = this._loadMessages();
    const msg = messages.find(m => m.id === messageId);
    
    if (msg) {
      msg.read = true;
      msg.readAt = Date.now();
      this._saveMessages(messages);
    }
    
    // 更新已读回执
    const receipts = this._loadReadReceipts();
    receipts[messageId] = Date.now();
    this._saveReadReceipts(receipts);
  }

  /**
   * 获取未读数
   */
  getUnreadCount(peerId = null) {
    const messages = this._loadMessages();
    
    let filtered = messages.filter(m => !m.read);
    
    if (peerId) {
      filtered = filtered.filter(m => 
        m.from?.id === peerId && m.to?.id === this.identityId
      );
    }
    
    return filtered.length;
  }

  /**
   * 保存好友
   */
  saveFriend(friend) {
    const friends = this._loadFriends();
    
    friends[friend.id] = {
      ...friend,
      addedAt: Date.now()
    };
    
    this._saveFriends(friends);
  }

  /**
   * 获取好友列表
   */
  getFriends() {
    return Object.values(this._loadFriends());
  }

  /**
   * 删除好友
   */
  removeFriend(friendId) {
    const friends = this._loadFriends();
    delete friends[friendId];
    this._saveFriends(friends);
  }

  // ========== 内部方法 ==========

  _ensureDataDir() {
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }
  }

  _loadMessages() {
    if (fs.existsSync(this.messagesFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.messagesFile, 'utf-8'));
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  _saveMessages(messages) {
    fs.writeFileSync(this.messagesFile, JSON.stringify(messages, null, 2));
  }

  _loadFriends() {
    if (fs.existsSync(this.friendsFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.friendsFile, 'utf-8'));
      } catch (e) {
        return {};
      }
    }
    return {};
  }

  _saveFriends(friends) {
    fs.writeFileSync(this.friendsFile, JSON.stringify(friends, null, 2));
  }

  _loadReadReceipts() {
    if (fs.existsSync(this.readReceiptsFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.readReceiptsFile, 'utf-8'));
      } catch (e) {
        return {};
      }
    }
    return {};
  }

  _saveReadReceipts(receipts) {
    fs.writeFileSync(this.readReceiptsFile, JSON.stringify(receipts, null, 2));
  }
}

module.exports = LinkStorage;
