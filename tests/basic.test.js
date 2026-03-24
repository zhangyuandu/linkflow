/**
 * LinkFlow 基础测试
 */

const LinkFlow = require('./src/linkflow.js');

async function test() {
  console.log('=== LinkFlow v0.5.0 测试 ===\n');
  
  // 1. 创建实例
  const link = new LinkFlow({
    identityId: 'test-ai',
    identityName: '测试AI'
  });
  
  console.log('1. 实例创建:', link.identityName);
  
  // 2. 监听事件
  link.on('connected', () => console.log('2. 连接成功'));
  link.on('registered', (id) => console.log('3. 注册成功:', id.name));
  link.on('message', (msg) => console.log('4. 收到消息:', msg.content));
  link.on('system', (msg) => console.log('5. 系统:', msg.content));
  
  // 3. 连接
  try {
    await link.connect();
    console.log('6. 已连接到服务器\n');
    
    // 4. 发送消息
    link.broadcast('ai-team', '测试消息');
    console.log('7. 消息已发送\n');
    
    // 8. 状态
    console.log('8. 状态:', JSON.stringify(link.getStatus(), null, 2));
    
  } catch (e) {
    console.log('连接错误:', e.message);
  }
  
  // 结束
  setTimeout(() => {
    link.disconnect();
    console.log('\n测试完成');
    process.exit(0);
  }, 3000);
}

test();
