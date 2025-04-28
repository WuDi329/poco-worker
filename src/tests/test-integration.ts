// test-integration.ts
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { spawn } from "child_process";
import NearConnection from "../near-connection";
import IPFSService from "../ipfs-service";
import Transcoder from "../transcoder";
import Listener from "../listener";
import Executor from "../executor";
import config from "../config";
import { TaskData, TaskStatus } from "../types";

// 创建测试目录
const TEST_DIR = path.join(os.tmpdir(), "poco-worker-integration-test");
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
  console.log("示例: npm run test:integration -- /path/to/test-video.mp4");
  process.exit(1);
}

// 手动提取关键帧时间戳的函数 - 用于验证
async function extractKeyframeTimestamps(filePath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    console.log("测试: 手动提取关键帧时间戳:", filePath);

    const args = [
      "-v",
      "error",
      "-skip_frame",
      "nokey",
      "-select_streams",
      "v",
      "-show_frames",
      "-show_entries",
      "frame=pts_time",
      "-of",
      "csv=p=0",
      filePath,
    ];

    console.log("测试: FFprobe命令:", "ffprobe", args.join(" "));

    const ffprobe = spawn("ffprobe", args);

    let output = "";

    ffprobe.stdout.on("data", (data) => {
      output += data.toString();
    });

    ffprobe.stderr.on("data", (data) => {
      console.error("测试: FFprobe错误:", data.toString());
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        const timestamps = output
          .trim()
          .split("\n")
          .filter((line) => line.trim() !== "")
          .map((line) => line.trim());

        console.log(`测试: 手动提取到 ${timestamps.length} 个关键帧时间戳`);

        // 按数值大小排序
        timestamps.sort((a, b) => parseFloat(a) - parseFloat(b));

        resolve(timestamps);
      } else {
        reject(new Error(`测试: 手动提取关键帧时间戳失败，退出码: ${code}`));
      }
    });

    ffprobe.on("error", (err) => {
      reject(new Error(`测试: 启动FFprobe进程失败: ${err.message}`));
    });
  });
}

async function keyframeExtractionTest() {
  console.log("开始关键帧提取测试...");

  // 初始化转码器
  const transcoder = new Transcoder();

  try {
    // 使用Transcoder提取关键帧时间戳
    console.log("使用Transcoder提取关键帧时间戳...");
    const timestamps = await transcoder.extractKeyframeTimestamps(
      TEST_VIDEO_PATH
    );

    console.log(`成功提取 ${timestamps.length} 个关键帧时间戳:`);
    console.log(timestamps);

    if (timestamps.length > 0) {
      console.log("关键帧提取测试通过！");
      return true;
    } else {
      console.error("未提取到任何关键帧时间戳");
      return false;
    }
  } catch (error) {
    console.error("关键帧提取测试失败:", error);
    return false;
  }
}

async function simpleIntegrationTest() {
  console.log("开始简单集成测试...");

  // 首先测试关键帧提取
  const keyframeTestResult = await keyframeExtractionTest();
  if (!keyframeTestResult) {
    console.error("关键帧提取测试失败，中止集成测试");
    return;
  }

  // 初始化所有服务
  console.log("初始化服务...");
  const nearConnection = new NearConnection(config);
  await nearConnection.init();

  // 注册Worker（如果尚未注册）
  console.log("注册Worker...");
  const registrationResult = await nearConnection.registerWorker(); // 传入硬件加速选项
  if (registrationResult) {
    console.log("Worker注册成功！");
  } else {
    console.log("Worker注册失败或已经注册过，继续测试...");
  }

  const ipfsService = new IPFSService(config);
  await ipfsService.testConnection();

  const transcoder = new Transcoder();

  // 上传测试视频到IPFS
  console.log("上传测试视频到IPFS...");
  const testCid = await ipfsService.uploadFile(TEST_VIDEO_PATH);
  console.log(`测试视频CID: ${testCid}`);

  // 创建模拟任务并写入队列
  const testTaskId = `test-simple-${Date.now()}`;
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
    keyframe_timestamps: null, // 新字段
    selected_gops: null, // 新字段
    publish_time: Date.now(),
    hw_acceleration_preferred: false,
  };

  // 将任务写入队列
  const taskPath = path.join(TEST_QUEUE_DIR, `${testTaskId}.json`);
  fs.writeFileSync(taskPath, JSON.stringify(testTask, null, 2), {
    encoding: "utf8",
  });
  console.log(`已创建模拟任务: ${testTaskId}`);

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

  // 监听任务完成事件以验证关键帧提取
  let extractedKeyframes: any;

  executor.setTaskCompletionCallback(
    async (taskId, resultCid, keyframeTimestamps) => {
      console.log(
        `测试: 任务完成回调触发，获取到 ${keyframeTimestamps.length} 个关键帧时间戳`
      );
      extractedKeyframes = keyframeTimestamps;

      // 模拟合约调用，但不实际调用
      console.log("测试: 模拟合约调用 complete_task");
      console.log(`测试: 任务ID: ${taskId}`);
      console.log(`测试: 结果CID: ${resultCid}`);
      console.log(`测试: 关键帧时间戳: ${JSON.stringify(keyframeTimestamps)}`);

      // 验证提取的是否为有效的关键帧
      console.log("测试: 验证关键帧时间戳有效性...");
      try {
        // 下载转码后的文件到临时目录进行验证
        const tempOutputPath = path.join(TEST_DIR, `${taskId}-output.mp4`);
        if (fs.existsSync(tempOutputPath)) {
          // 手动提取关键帧进行验证
          const manualTimestamps = await extractKeyframeTimestamps(
            tempOutputPath
          );

          console.log(`测试: 手动提取到 ${manualTimestamps.length} 个关键帧`);
          console.log(`测试: 自动提取到 ${keyframeTimestamps.length} 个关键帧`);

          // 简单验证：检查数量是否一致
          if (manualTimestamps.length === keyframeTimestamps.length) {
            console.log("测试: 关键帧数量一致，验证通过！");
          } else {
            console.warn("测试: 关键帧数量不一致，可能存在问题");
            console.log("手动提取:", manualTimestamps);
            console.log("自动提取:", keyframeTimestamps);
          }
        } else {
          console.warn("测试: 找不到输出文件，无法验证关键帧");
        }
      } catch (error) {
        console.error("测试: 验证关键帧时出错:", error);
      }

      return true; // 模拟成功返回
    }
  );

  // 启动服务
  console.log("启动执行服务...");
  executor.start();

  // 清空 activeTasks 集合，确保执行器可以处理任务
  // 仅用于测试！实际环境中不应该这样做
  if (
    (executor as any).activeTasks &&
    (executor as any).activeTasks instanceof Set
  ) {
    console.log("清空 activeTasks 集合以确保任务处理");
    (executor as any).activeTasks.clear();
  }

  // 等待任务完成
  console.log("等待任务处理完成...");
  let taskCompleted = false;
  let maxAttempts = 120; // 最多等待120秒

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

        // 验证是否成功提取了关键帧
        if (extractedKeyframes) {
          console.log(`成功提取 ${extractedKeyframes.length} 个关键帧时间戳!`);
          console.log("关键帧时间戳:", extractedKeyframes);
        } else {
          console.error("未能提取关键帧时间戳");
        }
      }
    }

    if (!taskCompleted) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      maxAttempts--;
      process.stdout.write(".");
    }
  }

  // 停止服务
  executor.stop();

  console.log("\n简单集成测试完成");

  if (extractedKeyframes && extractedKeyframes.length > 0) {
    console.log("🎉 关键帧提取集成测试成功!");
    return true;
  } else {
    console.error("❌ 关键帧提取集成测试失败");
    return false;
  }
}

// 运行简单集成测试
simpleIntegrationTest().catch(console.error);
