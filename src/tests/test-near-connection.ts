// test-near-connection.ts
import NearConnection from '../near-connection';
import config from '../config';

async function testNearConnection() {
  console.log('开始测试NEAR连接...');
  
  // 初始化连接
  const nearConnection = new NearConnection(config);
  const initialized = await nearConnection.init();
  
  if (!initialized) {
    console.error('NEAR连接初始化失败');
    return;
  }
  
  console.log('NEAR连接初始化成功');
  
  // 测试获取可用任务
  try {
    console.log('获取可用任务...');
    const availableTasks = await nearConnection.getAvailableTasks();
    console.log(`找到 ${availableTasks.length} 个可用任务:`);
    console.log(JSON.stringify(availableTasks, null, 2));
  } catch (error) {
    console.error('获取可用任务失败:', error);
  }
  
  // 测试获取工作节点任务
  try {
    console.log('获取工作节点任务...');
    const workerTasks = await nearConnection.getWorkerTasks();
    console.log(`找到 ${workerTasks.length} 个工作节点任务:`);
    console.log(JSON.stringify(workerTasks, null, 2));
  } catch (error) {
    console.error('获取工作节点任务失败:', error);
  }
}

// 运行测试
testNearConnection().catch(console.error);