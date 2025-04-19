// index.ts
import * as path from "path";
import NearConnection from "./near-connection";
import IPFSService from "./ipfs-service";
import Transcoder from "./transcoder";
import Listener from "./listener";
import Executor from "./executor";
import config from "./config";
import { WorkerState } from "./types";

// 工作目录
const WORK_DIR = path.join(process.cwd(), "worker-data");
const QUEUE_DIR = path.join(WORK_DIR, "queue");
const TASK_DIR = path.join(WORK_DIR, "tasks");

async function main() {
  console.log("启动POCO Worker服务...");

  // 初始化NEAR连接
  console.log("初始化NEAR连接...");
  const nearConnection = new NearConnection(config);
  const nearInitialized = await nearConnection.init();

  if (!nearInitialized) {
    console.error("NEAR连接初始化失败，服务终止");
    process.exit(1);
  }

  // 注册Worker（如果尚未注册）
  console.log("注册Worker...");
  const registrationResult = await nearConnection.registerWorker();
  if (!registrationResult) {
    console.warn("Worker注册失败，可能已经注册过或发生错误");
    // 继续运行，因为Worker可能已经注册过
  }

  // 初始化IPFS服务
  console.log("初始化IPFS服务...");
  const ipfsService = new IPFSService(config);
  const ipfsConnected = await ipfsService.testConnection();

  if (!ipfsConnected) {
    console.error("IPFS连接测试失败，服务终止");
    process.exit(1);
  }

  // 创建转码服务
  console.log("初始化转码服务...");
  const transcoder = new Transcoder();

  // 创建监听服务
  console.log("初始化监听服务...");
  const listener = new Listener(
    nearConnection,
    QUEUE_DIR,
    TASK_DIR,
    config.pollingInterval
  );

  // 创建执行服务
  console.log("初始化执行服务...");
  const executor = new Executor(
    nearConnection,
    ipfsService,
    transcoder,
    QUEUE_DIR,
    TASK_DIR,
    config.pollingInterval, // 更频繁地检查队列
    1
  );

  // 添加这个回调，让Executor可以通过Listener来完成与区块链的交互
  // 这样可以避免Executor直接调用区块链
  executor.setTaskCompletionCallback(
    async (taskId, resultCid, keyframeTimestamps) => {
      console.log(
        `通过Listener更新任务 ${taskId} 完成状态，关键帧时间戳: ${keyframeTimestamps.length}个`
      );
      return await nearConnection.completeTask(
        taskId,
        resultCid,
        keyframeTimestamps
      );
    }
  );
  // 启动服务
  console.log("启动所有服务...");

  // 设置心跳定时器
  // const heartbeatInterval = setInterval(async () => {
  //   try {
  //     await nearConnection.sendHeartbeat();
  //   } catch (error) {
  //     console.error("心跳发送失败:", error);
  //   }
  // }, config.pollingInterval);

  await Promise.all([listener.start(), executor.start()]);

  // 优雅地处理退出
  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  function handleShutdown() {
    console.log("收到退出信号，正在关闭服务...");
    listener.stop();
    executor.stop();

    // 等待一段时间确保资源释放
    setTimeout(() => {
      console.log("服务已安全关闭");
      process.exit(0);
    }, 1000);
  }
}

// 启动程序
main().catch((error) => {
  console.error("程序运行出错:", error);
  process.exit(1);
});
