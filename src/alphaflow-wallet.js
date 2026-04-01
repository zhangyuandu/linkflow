/**
 * AlphaFlow - 统一钱包服务
 * Ploutos 财富之神的实现
 * 
 * 所有钱包操作通过 AlphaFlow 进行:
 * - FID 链交互 (通过 FideiFlow/Pistis)
 * - 跨链操作
 * - 合约调用
 * - 资产管理
 * 
 * @version 1.0.0
 * @author Ploutos - 财富之神
 */

const crypto = require('crypto');

// FID 链合约地址 (由 Pistis/FideiFlow 管理)
const CONTRACTS = {
  FID: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  UUSD: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  Staking: '0xDc64a140Aa3E981100a9becA4E685f962f0cC9'
};

const FID_RPC = process.env.FID_RPC || 'http://localhost:8545';

class AlphaFlowWallet {
  constructor(options = {}) {
    this.nodeId = options.nodeId || 'alphaflow';
    this.fidRpcUrl = options.fidRpcUrl || FID_RPC;
    
    // 交易管理
    this.pendingTransactions = new Map();
    this.transactionHistory = new Map();
    
    // 缓存
    this.balanceCache = new Map();
    this.cacheTimeout = 5000;
  }

  /**
   * 统一 RPC 调用
   */
  async _call(method, params = []) {
    const response = await fetch(this.fidRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: 1
      })
    });
    
    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message);
    }
    return result.result;
  }

  /**
   * 获取 ETH 余额
   */
  async getBalance(address) {
    const cached = this.balanceCache.get(address);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.eth;
    }
    
    try {
      const balance = await this._call('eth_getBalance', [address, 'latest']);
      const ethBalance = parseInt(balance, 16) / 1e18;
      
      this.balanceCache.set(address, {
        eth: ethBalance,
        timestamp: Date.now()
      });
      
      return ethBalance;
    } catch (error) {
      console.error('❌ 获取余额失败:', error.message);
      return null;
    }
  }

  /**
   * 获取 UUSD 代币余额 (通过 FID 链合约)
   */
  async getUUSDBalance(address) {
    try {
      const data = '0x70a08231000000000000000000000000' + address.slice(2);
      const balance = await this._call('eth_call', [{
        to: CONTRACTS.UUSD,
        data
      }, 'latest']);
      
      return parseInt(balance, 16) / 1e18;
    } catch (error) {
      console.error('❌ 获取 UUSD 失败:', error.message);
      return null;
    }
  }

  /**
   * 获取完整余额 (ETH + UUSD + 其他代币)
   */
  async getFullBalance(address) {
    const [eth, uusd] = await Promise.all([
      this.getBalance(address),
      this.getUUSDBalance(address)
    ]);
    
    return {
      address,
      eth: eth || 0,
      uusd: uusd || 0,
      timestamp: Date.now()
    };
  }

  /**
   * 转账 ETH
   * @param {string} from - 发送方地址
   * @param {string} to - 接收方地址
   * @param {number} amount - 金额 (ETH)
   */
  async transferETH(from, to, amount) {
    try {
      const value = '0x' + (amount * 1e18).toString(16);
      
      const tx = {
        from,
        to,
        value,
        gas: '0x5208' // 21000 gas
      };
      
      const txHash = await this._call('eth_sendTransaction', [tx]);
      
      this._addHistory({
        hash: txHash,
        from,
        to,
        amount,
        token: 'ETH',
        status: 'pending',
        timestamp: Date.now()
      });
      
      console.log('💸 ETH 转账已发送:', txHash);
      return { success: true, txHash, status: 'pending' };
    } catch (error) {
      console.error('❌ ETH 转账失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 转账 UUSD 代币 (通过 FID 链合约)
   */
  async transferUUSD(from, to, amount) {
    try {
      const amountHex = '0x' + (amount * 1e18).toString(16).padStart(64, '0');
      const data = '0xa9059cbb' + 
        to.slice(2).padStart(64, '0') + 
        amountHex.slice(2);
      
      const txHash = await this._call('eth_sendTransaction', [{
        from,
        to: CONTRACTS.UUSD,
        data,
        gas: '0x1c4c40'
      }]);
      
      this._addHistory({
        hash: txHash,
        from,
        to,
        amount,
        token: 'UUSD',
        status: 'pending',
        timestamp: Date.now()
      });
      
      console.log('💸 UUSD 转账已发送:', txHash);
      return { success: true, txHash, status: 'pending' };
    } catch (error) {
      console.error('❌ UUSD 转账失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 统一转账接口 (自动选择代币类型)
   */
  async transfer(from, to, amount, token = 'ETH') {
    if (token.toUpperCase() === 'ETH') {
      return await this.transferETH(from, to, amount);
    } else if (token.toUpperCase() === 'UUSD') {
      return await this.transferUUSD(from, to, amount);
    } else {
      return { success: false, error: `不支持的代币: ${token}` };
    }
  }

  /**
   * 等待交易确认
   */
  async waitForConfirmation(txHash, timeoutMs = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const receipt = await this._call('eth_getTransactionReceipt', [txHash]);
        if (receipt) {
          const status = receipt.status === '0x1' ? 'confirmed' : 'failed';
          this._updateStatus(txHash, status);
          return {
            success: receipt.status === '0x1',
            status,
            blockNumber: parseInt(receipt.blockNumber, 16),
            gasUsed: parseInt(receipt.gasUsed, 16)
          };
        }
      } catch (e) {
        // 继续等待
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }
    
    return { success: false, status: 'timeout' };
  }

  /**
   * 获取交易状态
   */
  async getTransactionStatus(txHash) {
    try {
      const receipt = await this._call('eth_getTransactionReceipt', [txHash]);
      if (!receipt) return { status: 'pending' };
      
      return {
        status: receipt.status === '0x1' ? 'confirmed' : 'failed',
        blockNumber: parseInt(receipt.blockNumber, 16),
        gasUsed: parseInt(receipt.gasUsed, 16)
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * 获取交易历史
   */
  getHistory(address, limit = 10) {
    const history = this.transactionHistory.get(address.toLowerCase()) || [];
    return history.slice(-limit).reverse();
  }

  /**
   * 获取合约信息
   */
  getContracts() {
    return {
      AlphaFlow: 'ploutos-wallet-v1.0',
      FID: CONTRACTS.FID,
      UUSD: CONTRACTS.UUSD,
      Staking: CONTRACTS.Staking,
      rpc: this.fidRpcUrl
    };
  }

  // 内部方法
  _addHistory(tx) {
    const addr = tx.from.toLowerCase();
    if (!this.transactionHistory.has(addr)) {
      this.transactionHistory.set(addr, []);
    }
    this.transactionHistory.get(addr).push(tx);
  }

  _updateStatus(txHash, status) {
    for (const history of this.transactionHistory.values()) {
      const tx = history.find(t => t.hash === txHash);
      if (tx) {
        tx.status = status;
        break;
      }
    }
  }
}

module.exports = AlphaFlowWallet;