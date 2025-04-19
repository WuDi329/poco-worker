// executor.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import NearConnection from "./near-connection";
import IPFSService from "./ipfs-service";
import Transcoder from "./transcoder";
import { TaskData, TaskStatus } from "./types";
import { sleep } from "./utils";

export class Executor {
  private nearConnection: NearConnection;
  private ipfsService: IPFSService;
  private transcoder: Transcoder;
  private queueDir: string;
  private taskDir: string;
  private tempDir: string;
  private pollingInterval: number;
  private maxConcurrentTasks: number;
  private running: boolean = false;
  private activeTasks: Set<string> = new Set();

  constructor(
    nearConnection: NearConnection,
    ipfsService: IPFSService,
    transcoder: Transcoder,
    queueDir: string,
    taskDir: string,
    pollingInterval: number,
    maxConcurrentTasks: number
  ) {
    this.nearConnection = nearConnection;
    this.ipfsService = ipfsService;
    this.transcoder = transcoder;
    this.queueDir = queueDir;
    this.taskDir = taskDir;
    this.pollingInterval = pollingInterval;
    this.maxConcurrentTasks = maxConcurrentTasks;

    // 创建临时目录
    this.tempDir = path.join(os.tmpdir(), "poco-worker");
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * 启动执行服务
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log("执行服务已在运行中");
      return;
    }

    this.running = true;
    console.log("开始执行任务...");

    while (this.running) {
      try {
        await this.processQueuedTasks();
      } catch (error) {
        console.error("处理队列任务时出错:", error);
      }

      // 等待下一次检查
      await sleep(this.pollingInterval);
    }
  }

  /**
   * 停止执行服务
   */
  stop(): void {
    console.log("停止执行服务");
    this.running = false;
  }

  /**
   * 处理队列中的任务
   */
  private async processQueuedTasks(): Promise<void> {
    if (this.activeTasks.size > 0) {
      console.log("当前任务大于0，返回了");
      return;
    }
    // // 如果已经达到最大并发任务数，不处理新任务
    // if (this.activeTasks.size >= this.maxConcurrentTasks) {
    //   return;
    // }

    // 获取队列中的任务文件
    const queuedFiles = fs
      .readdirSync(this.queueDir)
      .filter((filename) => filename.endsWith(".json"));

    if (queuedFiles.length === 0) {
      return;
    }

    console.log(`队列中有 ${queuedFiles.length} 个任务等待处理`);

    // 计算可以处理的新任务数量
    const availableSlots = this.maxConcurrentTasks - this.activeTasks.size;
    const tasksToProcess = queuedFiles.slice(0, availableSlots);

    // 处理任务
    for (const filename of tasksToProcess) {
      const taskId = path.parse(filename).name;

      // 避免重复处理
      if (this.activeTasks.has(taskId)) {
        continue;
      }

      // 读取任务数据
      const taskFilePath = path.join(this.queueDir, filename);
      const taskData: TaskData = JSON.parse(
        fs.readFileSync(taskFilePath, "utf8")
      );

      // 标记为活动任务并开始处理
      this.activeTasks.add(taskId);
      this.processTask(taskData).finally(() => {
        // 处理完成后从活动任务中移除
        this.activeTasks.delete(taskId);
      });
    }
  }

  /**
   * 处理单个任务
   */
  private async processTask(task: TaskData): Promise<void> {
    console.log(`开始处理任务 ${task.task_id}`);

    try {
      // 将任务状态更新为处理中
      this.updateTaskStatus(task, "Processing");

      // 下载源文件
      const inputFilePath = path.join(
        this.tempDir,
        `${task.task_id}-input.mp4`
      );
      await this.ipfsService.downloadFile(task.source_ipfs, inputFilePath);

      // 准备输出文件路径
      const outputFilePath = path.join(
        this.tempDir,
        `${task.task_id}-output.mp4`
      );

      // 执行转码
      await this.transcoder.transcode(
        inputFilePath,
        outputFilePath,
        task.requirements
      );

      // 提取关键帧时间戳
      const keyframeTimestamps =
        await this.transcoder.extractKeyframeTimestamps(outputFilePath);
      console.log("关键帧时间戳:", keyframeTimestamps);

      // 上传结果到IPFS
      const resultCid = await this.ipfsService.uploadFile(outputFilePath);

      // 不直接调用区块链，而是通过回调函数通知Listener
      if (task.task_id.startsWith("test-")) {
        console.log(`测试任务 ${task.task_id}，跳过合约更新`);
        // this.updateTaskStatus(task, "Completed", resultCid, keyframeTimestamps);
      } else if (this.onTaskCompleted) {
        // 通过回调通知任务完成，同时传递关键帧时间戳
        await this.onTaskCompleted(task.task_id, resultCid, keyframeTimestamps);
      }

      // 更新本地任务状态
      this.updateTaskStatus(task, "Completed", resultCid, keyframeTimestamps);

      console.log(`任务 ${task.task_id} 处理成功，结果CID: ${resultCid}`);

      // 清理文件
      this.cleanupTaskFiles(task.task_id, inputFilePath, outputFilePath);
    } catch (error: any) {
      console.error(`处理任务 ${task.task_id} 时出错:`, error);
      this.updateTaskStatus(task, "Failed", null, null, String(error));
    }
  }

  // 添加回调函数属性
  private onTaskCompleted?: (
    taskId: string,
    resultCid: string,
    keyframeTimestamps: string[]
  ) => Promise<boolean>;

  // 修改设置回调的方法
  public setTaskCompletionCallback(
    callback: (
      taskId: string,
      resultCid: string,
      keyframeTimestamps: string[]
    ) => Promise<boolean>
  ): void {
    this.onTaskCompleted = callback;
  }
  /**
   * 锁定Worker状态
   */
  // private lockWorkerStatus(taskId: string): void {
  //   this.workerState.hasActiveTasks = true;
  //   this.workerState.currentTaskId = taskId;
  //   this.workerState.lockUntil = Date.now() + 3600000; // 锁定1小时，防止卡死
  // }

  /**
   * 解锁Worker状态
   */
  // private unlockWorkerStatus(): void {
  //   this.workerState.hasActiveTasks = false;
  //   this.workerState.currentTaskId = null;
  // }

  /**
   * 更新任务状态
   */
  private updateTaskStatus(
    task: TaskData,
    status: "Processing" | "Completed" | "Failed",
    resultCid?: string | null,
    keyframeTimestamps?: string[] | null,
    error?: string
  ): void {
    // 从队列中移除任务
    const queuedPath = path.join(this.queueDir, `${task.task_id}.json`);
    if (fs.existsSync(queuedPath)) {
      fs.unlinkSync(queuedPath);
    }

    // 保存到处理过的任务目录
    const taskInfo = {
      ...task,
      local_status: status,
      result_ipfs: resultCid || task.result_ipfs,
      error: error,
      completion_time: Date.now(),
      keyframe_timestamps: keyframeTimestamps || task.keyframeTimestamps,
    };

    const taskPath = path.join(this.taskDir, `${task.task_id}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(taskInfo, null, 2), {
      encoding: "utf8",
    });
  }

  /**
   * 清理任务文件
   */
  private cleanupTaskFiles(
    taskId: string,
    inputFilePath: string,
    outputFilePath: string
  ): void {
    try {
      // 删除临时文件
      if (fs.existsSync(inputFilePath)) {
        fs.unlinkSync(inputFilePath);
      }

      if (fs.existsSync(outputFilePath)) {
        fs.unlinkSync(outputFilePath);
      }

      console.log(`已清理任务 ${taskId} 的临时文件`);
    } catch (error) {
      console.error(`清理任务 ${taskId} 文件时出错:`, error);
    }
  }
}

export default Executor;
