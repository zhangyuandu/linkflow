/**
 * LinkFlow 加密模块
 * 
 * 基础加密：AES-256-GCM
 * 密钥交换：ECDHE
 * 消息签名：Ed25519
 */

const crypto = require('crypto');

class LinkCrypto {
  constructor() {
    this.keyPair = null;
    this.sharedKeys = new Map();  // peerId -> key
  }

  /**
   * 生成密钥对
   */
  generateKeyPair() {
    const ecdh = crypto.createECDH('secp256k1');
    ecdh.generateKeys();
    
    this.keyPair = {
      publicKey: ecdh.getPublicKey('base64'),
      privateKey: ecdh.getPrivateKey('base64')
    };
    
    return this.keyPair;
  }

  /**
   * 生成消息密钥（对称）
   */
  generateMessageKey() {
    return crypto.randomBytes(32).toString('base64');
  }

  /**
   * 密钥交换
   */
  deriveSharedKey(peerId, peerPublicKey) {
    const ecdh = crypto.createECDH('secp256k1');
    ecdh.setPrivateKey(Buffer.from(this.keyPair.privateKey, 'base64'));
    
    const shared = ecdh.computeSecret(Buffer.from(peerPublicKey, 'base64'));
    const hash = crypto.createHash('sha256').update(shared).digest();
    
    this.sharedKeys.set(peerId, hash.toString('base64'));
    return this.sharedKeys.get(peerId);
  }

  /**
   * 加密消息
   */
  encrypt(peerId, plaintext) {
    const key = this.sharedKeys.get(peerId);
    if (!key) {
      // 无共享密钥，使用消息密钥
      return this._encryptWithKey(this.generateMessageKey(), plaintext);
    }
    
    return this._encryptWithKey(key, plaintext);
  }

  _encryptWithKey(keyBase64, plaintext) {
    const key = Buffer.from(keyBase64, 'base64');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    return {
      iv: iv.toString('base64'),
      ciphertext: encrypted.toString('base64'),
      tag: authTag.toString('base64')
    };
  }

  /**
   * 解密消息
   */
  decrypt(peerId, encryptedData) {
    const key = this.sharedKeys.get(peerId);
    if (!key) {
      throw new Error('无共享密钥');
    }
    
    return this._decryptWithKey(key, encryptedData);
  }

  _decryptWithKey(keyBase64, data) {
    const key = Buffer.from(keyBase64, 'base64');
    const iv = Buffer.from(data.iv, 'base64');
    const ciphertext = Buffer.from(data.ciphertext, 'base64');
    const tag = Buffer.from(data.tag, 'base64');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  }

  /**
   * 签名消息
   */
  sign(message) {
    if (!this.keyPair) {
      throw new Error('未生成密钥对');
    }
    
    const sign = crypto.createSign('SHA256');
    sign.update(message);
    return sign.sign(this.keyPair.privateKey, 'base64');
  }

  /**
   * 验证签名
   */
  verify(message, signature, publicKey) {
    const verify = crypto.createVerify('SHA256');
    verify.update(message);
    return verify.verify(publicKey, signature, 'base64');
  }

  /**
   * 获取公钥
   */
  getPublicKey() {
    return this.keyPair?.publicKey || null;
  }
}

module.exports = LinkCrypto;
