// near-connection.ts
import { connect, KeyPair, keyStores, Contract, Account } from "near-api-js";
import { TaskData, WorkerConfig } from "./types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { WorkerStatus, WorkerTaskCollection } from "./types";
import { providers } from "near-api-js";

// 扩展 ConnectConfig 类型
// type ConnectConfigWithFetch = ConnectConfig & {
//     fetch?: any;
//   };

export class NearConnection {
  private config: WorkerConfig;
  private nearConnection: any;
  private accountId: string;
  private contractId: string;
  private contract: any;

  constructor(config: WorkerConfig) {
    this.config = config;
    this.accountId = config.workerAccountId;
    this.contractId = config.contractId;
  }

  /**
   * 初始化NEAR连接
   */
  async init(): Promise<boolean> {
    try {
      // 创建代理
      const proxyAgent = new HttpsProxyAgent("http://127.0.0.1:10809");

      // 设置自定义的全局 fetch (不在 connect 配置中传递)
      (global as any).fetch = (url: string, options: any = {}) => {
        return fetch(url, {
          ...options,
          agent: proxyAgent,
          timeout: 30000, // 增加超时时间
        });
      };

      // 配置密钥存储
      const keyStore = this.getKeyStore();

      // 连接到 NEAR (不传递 fetch)
      this.nearConnection = await connect({
        ...this.config.nearConfig,
        keyStore,
        headers: {},
      });

      // 连接到NEAR
      //   this.nearConnection = await connect(Object.assign({ keyStore }, this.config.nearConfig));

      // 获取账户对象
      const account = await this.nearConnection.account(this.accountId);

      // 初始化合约接口
      this.contract = new Contract(account, this.contractId, {
        // 视图方法 - 不需要签名
        viewMethods: [
          "get_available_tasks",
          "get_task",
          "get_worker_tasks",
          "get_consensus_proof",
          "get_worker_info",
          "get_task_queue",
        ],
        // 修改方法 - 需要签名
        changeMethods: [
          "complete_task",
          "register_worker",
          "worker_heartbeat",
          "submit_offer",
          "get_tasks_for_worker",
        ],
        useLocalViewExecution: false,
      });

      console.log(`已连接到NEAR网络，合约ID: ${this.contractId}`);
      return true;
    } catch (error) {
      console.error("连接NEAR网络失败:", error);
      return false;
    }
  }

  /**
   * 获取密钥存储
   */
  private getKeyStore(): keyStores.KeyStore {
    // 创建内存密钥存储
    const keyStore = new keyStores.InMemoryKeyStore();

    try {
      // 从文件读取凭证
      let credentialsPath =
        this.config.credentialsPath ||
        path.join(os.homedir(), ".near-credentials");

      // 如果路径以~开头，替换为用户主目录
      if (credentialsPath.startsWith("~")) {
        credentialsPath = credentialsPath.replace("~", os.homedir());
      }

      const networkPath = path.join(
        credentialsPath,
        this.config.nearConfig.networkId
      );

      console.log(`尝试加载NEAR凭证目录: ${networkPath}`);

      if (!fs.existsSync(networkPath)) {
        throw new Error(`未找到NEAR凭证目录: ${networkPath}`);
      }

      const credentialsFilePath = path.join(
        networkPath,
        `${this.accountId}.json`
      );
      console.log(`尝试加载账户凭证文件: ${credentialsFilePath}`);

      if (!fs.existsSync(credentialsFilePath)) {
        throw new Error(`未找到账户凭证文件: ${credentialsFilePath}`);
      }

      const credentials = JSON.parse(
        fs.readFileSync(credentialsFilePath, "utf-8")
      );
      const keyPair = KeyPair.fromString(credentials.private_key);

      // 将密钥添加到存储
      keyStore.setKey(
        this.config.nearConfig.networkId,
        this.accountId,
        keyPair
      );
      console.log(`已加载账户凭证: ${this.accountId}`);

      return keyStore;
    } catch (error) {
      console.error("加载密钥失败:", error);
      throw error;
    }
  }

  /**
   * 获取可用任务
   */
  async getAvailableTasks(
    fromIndex: number = 0,
    limit: number = 10
  ): Promise<TaskData[]> {
    try {
      const tasks: TaskData[] = await this.contract.get_available_tasks({
        from_index: fromIndex,
        limit,
      });
      return tasks;
    } catch (error) {
      console.error("获取可用任务失败:", error);
      return [];
    }
  }

  /**
   * 获取工作节点已分配的任务
   */
  async getWorkerTasks(): Promise<TaskData[]> {
    try {
      const tasks: TaskData[] = await this.contract.get_worker_tasks({
        worker_id: this.accountId,
      });
      return tasks;
    } catch (error) {
      console.error("获取工作节点任务失败:", error);
      return [];
    }
  }

  /**
   * 获取特定任务
   */
  async getTask(taskId: string): Promise<TaskData | null> {
    console.log("inside near-connection, getTask");
    try {
      const task: TaskData = await this.contract.get_task({ task_id: taskId });
      return task;
    } catch (error) {
      console.error(`获取任务 ${taskId} 失败:`, error);
      return null;
    }
  }

  /**
   * 完成任务
   * @param taskId 任务ID
   * @param resultIpfs 结果文件IPFS哈希
   * @param keyframeTimestamps 关键帧时间戳列表
   * @returns 是否成功
   */
  async completeTask(
    taskId: string,
    resultIpfs: string,
    keyframeTimestamps: string[]
  ): Promise<boolean> {
    try {
      await this.contract.complete_task({
        task_id: taskId,
        result_ipfs: resultIpfs,
        keyframe_timestamps: keyframeTimestamps,
      });
      console.log(`任务 ${taskId} 已标记为完成，结果: ${resultIpfs}`);
      return true;
    } catch (error) {
      console.error(`完成任务 ${taskId} 失败:`, error);
      return false;
    }
  }

  // 向near-connection.ts添加新的合约交互方法

  /**
   * 注册Worker
   */
  async registerWorker(): Promise<boolean> {
    try {
      // 默认没有硬件加速
      const hasHwAcceleration = false;
      await this.contract.register_worker({
        has_hw_acceleration: hasHwAcceleration,
      });
      console.log("Worker注册成功");
      return true;
    } catch (error) {
      console.error("Worker注册失败:", error);
      return false;
    }
  }

  /**
   * 发送Worker心跳
   */
  async sendHeartbeat(): Promise<WorkerStatus> {
    try {
      const status = await this.contract.worker_heartbeat({});
      console.log("心跳响应:", status);
      return status;
    } catch (error) {
      console.error("发送心跳失败:", error);
      // 返回默认状态
      return {
        is_registered: false,
        current_task: null,
        qos_score: 0.0,
      };
    }
  }
  /**
   * 获取Worker相关任务（统一API）
   */
  async getTasksForWorker(): Promise<WorkerTaskCollection> {
    try {
      const tasks = await this.contract.get_tasks_for_worker({
        worker_id: this.accountId,
      });
      return tasks;
    } catch (error) {
      console.error("获取Worker相关任务失败:", error);
      return {
        assigned_tasks: [],
        available_tasks: [],
        queued_tasks: [],
      };
    }
  }

  /**
   * 提交任务offer
   */
  async submitOffer(taskId: string): Promise<boolean> {
    try {
      const result = await this.contract.submit_offer({ task_id: taskId });
      console.log(`为任务 ${taskId} 提交offer结果:`, result);
      return result;
    } catch (error) {
      console.error(`为任务 ${taskId} 提交offer失败:`, error);
      return false;
    }
  }

  /**
   * 获取Worker信息
   */
  async getWorkerInfo(): Promise<any> {
    try {
      const workerInfo = await this.contract.get_worker_info({
        worker_id: this.accountId,
      });
      return workerInfo;
    } catch (error) {
      console.error("获取Worker信息失败:", error);
      return null;
    }
  }

  /**
   * 获取任务队列
   */
  async getTaskQueue(): Promise<string[]> {
    try {
      const taskQueue = await this.contract.get_task_queue({});
      return taskQueue;
    } catch (error) {
      console.error("获取任务队列失败:", error);
      return [];
    }
  }
}

export default NearConnection;
