// types.ts
export enum TaskStatus {
  Published = "Published",
  Assigned = "Assigned",
  Completed = "Completed",
  Verified = "Verified",
  Queued = "Queued",
  OfferCollecting = "OfferCollecting",
}

export interface WorkerStatus {
  is_registered: boolean;
  current_task: string | null;
  qos_score: number;
}

export interface WorkerTaskCollection {
  assigned_tasks: TaskData[];
  available_tasks: TaskData[];
  queued_tasks: string[];
}

export interface WorkerState {
  hasActiveTasks: boolean;
  currentTaskId: string | null;
  lockUntil: number;
}

export interface TranscodingRequirement {
  target_codec: string;
  target_resolution: string;
  target_bitrate: string;
  target_framerate: string;
  additional_params: string;
}

export interface TaskData {
  task_id: string;
  broadcaster_id: string;
  source_ipfs: string;
  requirements: TranscodingRequirement;
  status: TaskStatus;
  assigned_worker: string | null;
  assignment_time: number | null;
  result_ipfs: string | null;
  completion_time: number | null;
  assigned_verifiers: string[];
  qos_proof_id: string | null;
  publish_time: number;
  hw_acceleration_preferred: boolean;
}

export interface WorkerConfig {
  nearConfig: {
    networkId: string;
    nodeUrl: string;
    walletUrl: string;
    helperUrl: string;
    explorerUrl: string;
  };
  contractId: string;
  workerAccountId: string;
  credentialsPath: string;
  ipfsConfig: {
    host: string;
    port: number;
    protocol: string;
  };
  pollingInterval: number; // 毫秒
  maxConcurrentTasks: number;
}

// 添加WorkerInfo接口
export interface WorkerInfo {
  account_id: string;
  has_hw_acceleration: boolean;
  last_heartbeat: number;
  available: boolean;
  current_task: string | null;
  qos_score: number;
  service_reliability_score: number;
  time_stability_score: number;
  performance_score: number;
  total_tasks_completed: number;
  active_days_last_week: number;
}
