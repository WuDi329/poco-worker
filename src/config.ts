// config.ts
import { WorkerConfig } from "./types";

const config: WorkerConfig = {
  nearConfig: {
    networkId: "testnet", // 或者 'mainnet', 取决于您部署的网络
    nodeUrl: "https://rpc.testnet.near.org",
    walletUrl: "https://wallet.testnet.near.org",
    helperUrl: "https://helper.testnet.near.org",
    explorerUrl: "https://explorer.testnet.near.org",
  },
  contractId: "pococontract11.testnet", // 例如 media-transcoding.testnet
  workerAccountId: "pocoworker1.testnet", // 例如 worker1.testnet
  credentialsPath: "~/.near-credentials", // NEAR凭证路径
  ipfsConfig: {
    host: "127.0.0.1",
    port: 5001,
    protocol: "http",
  },
  pollingInterval: 10000, // 轮询间隔10秒
  maxConcurrentTasks: 2, // 最大同时处理2个任务
};

export default config;
