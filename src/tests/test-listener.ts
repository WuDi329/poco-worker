// test-listener.ts
import NearConnection from "../near-connection";
import Listener from "../listener";
import config from "../config";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { TaskStatus, WorkerStatus, WorkerTaskCollection } from "../types";

// 创建测试目录
const TEST_DIR = path.join(os.tmpdir(), "poco-worker-test-listener");
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

// 模拟任务数据
const mockTaskData = {
  task_id: `test-task-${Date.now()}`,
  broadcaster_id: "broadcaster.testnet",
  source_ipfs: "QmTest123456789",
  requirements: {
    target_codec: "h264",
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
  publish_time: Date.now(),
  hw_acceleration_preferred: false,
};

// 模拟 NearConnection 类
class MockNearConnection {
  async getWorkerStatus(): Promise<WorkerStatus> {
    console.log("模拟获取Worker状态...");
    return {
      is_registered: true,
      current_task: null,
      qos_score: 0.8,
    };
  }

  async sendHeartbeat(): Promise<WorkerStatus> {
    console.log("模拟发送心跳...");
    return {
      is_registered: true,
      current_task: null,
      qos_score: 0.8,
    };
  }

  async getTasksForWorker(): Promise<WorkerTaskCollection> {
    console.log("模拟获取Worker任务集合...");
    return {
      assigned_tasks: [mockTaskData],
      available_tasks: [],
      queued_tasks: [],
    };
  }

  async registerWorker(): Promise<boolean> {
    console.log("模拟注册Worker...");
    return true;
  }

  // 为兼容性添加原来的方法
  async getWorkerTasks() {
    console.log("模拟获取工作节点任务...");
    return [mockTaskData];
  }

  async getTask(taskId: string) {
    console.log(`模拟获取任务 ${taskId}...`);
    return mockTaskData;
  }

  async submitOffer(taskId: string): Promise<boolean> {
    console.log(`模拟为任务 ${taskId} 提交offer...`);
    return true;
  }
}

async function testListener() {
  console.log("开始测试监听服务...");

  // 使用真实的Near连接进行测试
  console.log("初始化NEAR连接...");
  const nearConnection = new NearConnection(config);
  const initialized = await nearConnection.init();

  if (!initialized) {
    console.log("使用NEAR连接失败，切换到模拟数据");
    // 使用模拟数据作为后备
    testWithMockData();
    return;
  }

  // 创建监听服务
  const listener = new Listener(
    nearConnection,
    TEST_QUEUE_DIR,
    TEST_TASK_DIR,
    5000 // 5秒轮询间隔
  );

  // 手动轮询一次
  console.log("执行轮询操作...");
  // @ts-ignore - 访问私有方法进行测试
  await listener.pollTasks();

  // 检查队列目录
  const queuedFiles = fs.readdirSync(TEST_QUEUE_DIR);
  console.log(`队列中的文件数量: ${queuedFiles.length}`);
  queuedFiles.forEach((file) => {
    console.log(`- ${file}`);
    const content = fs.readFileSync(path.join(TEST_QUEUE_DIR, file), "utf8");
    console.log(`  内容: ${content.substring(0, 100)}...`);
  });

  // 停止心跳服务
  listener.stop();

  console.log("监听服务测试完成");
}

function testWithMockData() {
  console.log("使用模拟数据测试监听服务...");

  // 使用模拟的Near连接
  const mockNearConnection =
    new MockNearConnection() as unknown as NearConnection;

  // 创建监听服务
  const listener = new Listener(
    mockNearConnection,
    TEST_QUEUE_DIR,
    TEST_TASK_DIR,
    5000 // 5秒轮询间隔
  );

  // 手动轮询一次
  console.log("执行轮询操作...");
  // @ts-ignore - 访问私有方法进行测试
  listener.pollTasks().then(() => {
    // 检查队列目录
    const queuedFiles = fs.readdirSync(TEST_QUEUE_DIR);
    console.log(`队列中的文件数量: ${queuedFiles.length}`);
    queuedFiles.forEach((file) => {
      console.log(`- ${file}`);
      const content = fs.readFileSync(path.join(TEST_QUEUE_DIR, file), "utf8");
      console.log(`  内容: ${content.substring(0, 100)}...`);
    });

    // 停止心跳服务
    listener.stop();

    console.log("模拟监听服务测试完成");
  });
}

testListener().catch(console.error);
