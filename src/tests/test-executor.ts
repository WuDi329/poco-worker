// test-executor.ts
import NearConnection from "../near-connection";
import IPFSService from "../ipfs-service";
import Transcoder from "../transcoder";
import Executor from "../executor";
import config from "../config";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { TaskStatus } from "../types";

// 创建测试目录
const TEST_DIR = path.join(os.tmpdir(), "poco-worker-test-executor");
const TEST_QUEUE_DIR = path.join(TEST_DIR, "queue");
const TEST_TASK_DIR = path.join(TEST_DIR, "tasks");

// 确保测试目录存在
if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}
if (!fs.existsSync(TEST_QUEUE_DIR)) {
  fs.mkdirSync(TEST_QUEUE_DIR, { recursive: true });
}
if (!fs.existsSync(TEST_TASK_DIR)) {
  fs.mkdirSync(TEST_TASK_DIR, { recursive: true });
}

// 需要一个测试视频文件
const TEST_VIDEO_PATH = process.argv[2];
if (!TEST_VIDEO_PATH || !fs.existsSync(TEST_VIDEO_PATH)) {
  console.error("请提供有效的测试视频文件路径作为参数");
  console.log("示例: npm run test:executor -- /path/to/test-video.mp4");
  process.exit(1);
}

async function testExecutor() {
  console.log("开始测试执行服务...");

  // 初始化服务
  console.log("初始化NEAR连接...");
  const nearConnection = new NearConnection(config);
  const nearInitialized = await nearConnection.init();

  console.log("初始化IPFS服务...");
  const ipfsService = new IPFSService(config);
  const ipfsConnected = await ipfsService.testConnection();

  if (!nearInitialized || !ipfsConnected) {
    console.error("服务初始化失败");
    return;
  }

  // 创建转码服务
  const transcoder = new Transcoder();

  // 上传测试视频到IPFS
  console.log("上传测试视频到IPFS...");
  const testCid = await ipfsService.uploadFile(TEST_VIDEO_PATH);
  console.log(`测试视频CID: ${testCid}`);

  // 创建模拟任务 - 添加新版合约所需字段
  const testTaskId = `test-executor-${Date.now()}`;
  const testTask = {
    task_id: testTaskId,
    broadcaster_id: "broadcaster.testnet",
    source_ipfs: testCid,
    requirements: {
      target_codec: "h265",
      target_resolution: "original",
      target_bitrate: "2000k",
      target_framerate: "original",
      additional_params: "",
    },
    status: TaskStatus.Assigned,
    assigned_worker: config.workerAccountId,
    assignment_time: Date.now(),
    result_ipfs: null,
    completion_time: null,
    assigned_verifiers: [],
    qos_proof_id: null,
    // 新增字段
    publish_time: Date.now(),
    hw_acceleration_preferred: false,
  };

  // 将模拟任务写入队列
  const taskPath = path.join(TEST_QUEUE_DIR, `${testTaskId}.json`);
  fs.writeFileSync(taskPath, JSON.stringify(testTask, null, 2), {
    encoding: "utf8",
  });
  console.log(`已创建模拟任务: ${testTaskId}`);

  // 模拟Worker心跳响应，确保Executor可以处理任务
  // 假设这个方法已经实现（需要实现）
  await mockWorkerHeartbeat(nearConnection, testTaskId);

  // 创建执行服务
  const executor = new Executor(
    nearConnection,
    ipfsService,
    transcoder,
    TEST_QUEUE_DIR,
    TEST_TASK_DIR,
    1000, // 1秒检查间隔
    1 // 最大1个并发任务
  );

  // 手动处理队列任务
  console.log("执行任务处理...");
  // @ts-ignore - 访问私有方法进行测试
  await executor.processQueuedTasks();

  // 等待任务完成
  console.log("等待任务处理完成...");
  let taskCompleted = false;
  let maxAttempts = 60; // 最多等待60秒

  while (!taskCompleted && maxAttempts > 0) {
    const taskFiles = fs.readdirSync(TEST_TASK_DIR);
    const completedTask = taskFiles.find((file) => file.includes(testTaskId));

    if (completedTask) {
      const taskFile = path.join(TEST_TASK_DIR, completedTask);
      const taskData = JSON.parse(fs.readFileSync(taskFile, "utf8"));

      console.log(`任务状态: ${taskData.local_status}`);
      if (
        taskData.local_status === "Completed" ||
        taskData.local_status === "Failed"
      ) {
        taskCompleted = true;
        console.log(`任务处理结果:`);
        console.log(JSON.stringify(taskData, null, 2));
      }
    }

    if (!taskCompleted) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      maxAttempts--;
      process.stdout.write(".");
    }
  }

  console.log("\n执行服务测试完成");
}

// 模拟Worker心跳响应，添加当前任务信息
async function mockWorkerHeartbeat(
  nearConnection: NearConnection,
  taskId: string
) {
  // 这个函数需要根据你的nearConnection实现来修改
  // 目的是确保执行器能够识别到它应该处理这个任务

  // 如果你的NearConnection支持模拟或测试模式，可以直接调用
  if (typeof nearConnection.mockHeartbeatResponse === "function") {
    await nearConnection.mockHeartbeatResponse({
      is_registered: true,
      current_task: taskId,
      qos_score: 0.8,
    });
  } else {
    console.log("无法模拟心跳响应，测试可能无法正常进行");
    // 如果无法直接模拟，可以考虑创建一个临时文件表示心跳状态
  }
}

testExecutor().catch(console.error);
