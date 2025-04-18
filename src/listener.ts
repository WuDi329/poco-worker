// listener.ts
import * as fs from "fs";
import * as path from "path";
import NearConnection from "./near-connection";
import { TaskData, TaskStatus } from "./types";
import { sleep } from "./utils";

export class Listener {
  private nearConnection: NearConnection;
  private queueDir: string;
  private taskDir: string;
  private pollingInterval: number;
  private running: boolean = false;
  // 添加activeTasks属性
  private activeTasks: Set<string> = new Set();
  private heartbeatInterval?: NodeJS.Timeout;
  // 添加已提交offer的任务跟踪
  // private offerSubmittedTasks: Set<string> = new Set();

  constructor(
    nearConnection: NearConnection,
    queueDir: string,
    taskDir: string,
    pollingInterval: number
  ) {
    this.nearConnection = nearConnection;
    this.queueDir = queueDir;
    this.taskDir = taskDir;
    this.pollingInterval = pollingInterval;

    // 确保队列和任务目录存在
    if (!fs.existsSync(this.queueDir)) {
      fs.mkdirSync(this.queueDir, { recursive: true });
    }

    if (!fs.existsSync(this.taskDir)) {
      fs.mkdirSync(this.taskDir, { recursive: true });
    }
  }

  /**
   * 启动监听服务
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log("监听服务已在运行中");
      return;
    }

    this.running = true;
    console.log("开始监听任务...");

    // 启动心跳服务
    this.startHeartbeatService();

    while (this.running) {
      try {
        // 先检查worker状态
        const workerStatus = await this.nearConnection.sendHeartbeat();

        // 只有在没有当前任务时才轮询新任务
        if (!workerStatus.current_task) {
          await this.pollTasks();
        } else {
          console.log(
            `当前有任务 ${workerStatus.current_task}，跳过轮询新任务`
          );
          // 确保任务在本地队列中
          await this.ensureTaskInQueue(workerStatus.current_task);
        }
      } catch (error) {
        console.error("轮询任务时出错:", error);
      }

      // 等待下一次轮询
      await sleep(this.pollingInterval);
    }
  }

  // 新增方法，确保任务在本地队列中
  private async ensureTaskInQueue(taskId: string): Promise<void> {
    if (!this.isTaskQueued(taskId)) {
      console.log(`将已分配任务 ${taskId} 同步到本地队列`);
      const task = await this.nearConnection.getTask(taskId);
      if (task) {
        this.queueTask(task);
      }
    }
  }

  private startHeartbeatService(): void {
    // 清除已有定时器（如果有）
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // 设置新的心跳定时器
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.nearConnection.sendHeartbeat();
        // console.log("心跳发送成功");
      } catch (error) {
        console.error("心跳发送失败:", error);
      }
    }, this.pollingInterval);
  }

  /**
   * 停止监听服务
   */
  stop(): void {
    console.log("停止监听服务");
    this.running = false;

    // 清除心跳定时器
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  /**
   * 轮询处理任务
   */
  private async pollTasks(): Promise<void> {
    console.log("开始轮询处理任务...");

    try {
      // 1. 发送心跳并获取状态
      // const workerStatus = await this.nearConnection.sendHeartbeat();

      // // 2. 如果Worker未注册，先进行注册
      // if (!workerStatus.is_registered) {
      //   console.log("Worker未注册，进行注册...");
      //   const registered = await this.nearConnection.registerWorker();
      //   if (!registered) {
      //     console.error("Worker注册失败，等待下次尝试");
      //     return;
      //   }
      // }

      // // 3. 检查Worker是否有当前任务
      // if (workerStatus.current_task) {
      //   console.log(`Worker当前有任务: ${workerStatus.current_task}`);
      //   // 只处理已分配的任务，确保任务被正确加入队列
      //   // await this.syncAssignedTasks();
      //   // 确保已分配的任务在本地队列中
      //   const task = await this.nearConnection.getTask(
      //     workerStatus.current_task
      //   );
      //   if (task && !this.isTaskQueued(task.task_id)) {
      //     this.queueTask(task);
      //   }
      //   return;
      // }

      // 4. Worker空闲，获取所有相关任务
      console.log("Worker当前空闲，获取可能的任务...");
      const taskCollection = await this.nearConnection.getTasksForWorker();

      console.log("接收到getTasksForWorker");
      console.log(taskCollection);

      // 5. 按优先级处理任务

      // a. 先处理已分配任务（双重检查）
      if (taskCollection.assigned_tasks.length > 0) {
        console.log(
          `发现 ${taskCollection.assigned_tasks.length} 个已分配任务`
        );
        for (const task of taskCollection.assigned_tasks) {
          if (!this.isTaskQueued(task.task_id)) {
            console.log(`将任务 ${task.task_id} 加入处理队列`);
            this.queueTask(task);
          }
        }
        return;
      }

      // b. 再处理队列中的任务
      if (taskCollection.queued_tasks.length > 0) {
        console.log(
          `当前有 ${taskCollection.queued_tasks.length} 个任务在队列中等待分配`
        );
      }

      // c. 最后处理可提交offer的任务
      if (taskCollection.available_tasks.length > 0) {
        // 检查本地状态是否允许接受新任务
        const canAcceptNewTask = this.checkLocalResourceAvailability();
        if (!canAcceptNewTask) {
          console.log("本地资源不足，暂不提交新offer");
          return;
        }
        console.log(
          `发现 ${taskCollection.available_tasks.length} 个可提交offer的任务`
        );
        // 选择第一个任务提交offer
        const task = taskCollection.available_tasks[0];
        console.log(`为任务 ${task.task_id} 提交offer...`);

        const offerResult = await this.nearConnection.submitOffer(task.task_id);
        if (offerResult) {
          console.log(`成功为任务 ${task.task_id} 提交offer`);
        } else {
          console.warn(`为任务 ${task.task_id} 提交offer失败`);
        }
      } else {
        console.log("当前没有可处理的任务");
      }
    } catch (error) {
      console.error("轮询处理任务出错:", error);
    }
  }

  private checkLocalResourceAvailability(): boolean {
    // 简单实现：检查是否已有活跃任务
    if (this.activeTasks.size > 0) {
      console.log("已有活跃任务，不接受新任务");
      return false;
    }

    // 检查是否有队列中等待的任务
    const queuedFiles = fs
      .readdirSync(this.queueDir)
      .filter((filename) => filename.endsWith(".json"));

    if (queuedFiles.length > 0) {
      console.log("本地队列中已有任务，不接受新任务");
      return false;
    }
    return true; // 所有检查通过，可以接受新任务
  }

  /**
   * 同步已分配任务到本地队列
   */
  // private async syncAssignedTasks(): Promise<void> {
  //   // 获取已分配的任务
  //   const workerTasks = await this.nearConnection.getWorkerTasks();

  //   // 过滤出Assigned状态的任务
  //   const assignedTasks = workerTasks.filter(
  //     (task) => task.status === TaskStatus.Assigned
  //   );

  //   if (assignedTasks.length === 0) {
  //     return;
  //   }

  //   console.log(`同步 ${assignedTasks.length} 个已分配任务`);

  //   // 检查任务是否已在本地队列
  //   for (const task of assignedTasks) {
  //     if (!this.isTaskQueued(task.task_id)) {
  //       console.log(`将任务 ${task.task_id} 添加到队列`);
  //       this.queueTask(task);
  //     }
  //   }
  // }

  /**
   * 检查任务是否已在队列中
   */
  private isTaskQueued(taskId: string): boolean {
    const queuedPath = path.join(this.queueDir, `${taskId}.json`);
    const processedPath = path.join(this.taskDir, `${taskId}.json`);

    return fs.existsSync(queuedPath) || fs.existsSync(processedPath);
  }

  /**
   * 将任务添加到队列
   */
  private queueTask(task: TaskData): void {
    const queuedPath = path.join(this.queueDir, `${task.task_id}.json`);

    try {
      fs.writeFileSync(queuedPath, JSON.stringify(task, null, 2), {
        encoding: "utf8",
      });

      console.log(`任务 ${task.task_id} 已添加到队列`);
    } catch (error) {
      console.error(`将任务 ${task.task_id} 添加到队列时出错:`, error);
    }
  }
}

export default Listener;
