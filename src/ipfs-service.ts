// ipfs-service.ts
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import { WorkerConfig } from './types';

export class IPFSService {
  private apiUrl: string;

  constructor(config: WorkerConfig) {
    this.apiUrl = `${config.ipfsConfig.protocol}://${config.ipfsConfig.host}:${config.ipfsConfig.port}/api/v0`;
  }

  /**
   * 测试IPFS连接
   */
  async testConnection(): Promise<boolean> {
    try {
      // 修改为使用 POST 请求
      const response = await fetch(`${this.apiUrl}/version`, {
        method: 'POST'
      });
      const data = await response.json();
      console.log(`已连接到IPFS节点，版本: ${data.Version}`);
      return true;
    } catch (error) {
      console.error('连接IPFS节点失败:', error);
      return false;
    }
  }

  /**
   * 上传文件到IPFS
   * @param filePath 要上传的文件路径
   */
  async uploadFile(filePath: string): Promise<string> {
    try {
      console.log(`开始上传文件到IPFS: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }
      
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));
      
      const response = await fetch(`${this.apiUrl}/add?pin=true`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
      });
      
      const data = await response.json();
      console.log(`文件上传成功, CID: ${data.Hash}`);
      return data.Hash;
    } catch (error) {
      console.error('上传文件到IPFS失败:', error);
      throw error;
    }
  }

  /**
   * 从IPFS下载文件
   * @param cid IPFS文件的CID
   * @param outputPath 输出文件路径
   */
  async downloadFile(cid: string, outputPath: string): Promise<string> {
    try {
      console.log(`开始从IPFS下载文件: ${cid}`);
      
      // 确保输出目录存在
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // 修改为使用 POST 请求
      const response = await fetch(`${this.apiUrl}/cat?arg=${cid}`, {
        method: 'POST'
      });
      const buffer = await response.buffer();
      
      fs.writeFileSync(outputPath, buffer);
      
      console.log(`文件下载成功: ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.error(`从IPFS下载文件失败(CID: ${cid}):`, error);
      throw error;
    }
  }
}

export default IPFSService;