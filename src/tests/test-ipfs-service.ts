// test-ipfs-service.ts
import IPFSService from '../ipfs-service';
import config from '../config';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

async function testIPFSService() {
  console.log('开始测试IPFS服务...');
  
  // 初始化IPFS服务
  const ipfsService = new IPFSService(config);
  
  // 测试连接
  const connectionResult = await ipfsService.testConnection();
  if (!connectionResult) {
    console.error('IPFS连接测试失败，请检查IPFS节点是否启动');
    return;
  }
  
  console.log('IPFS连接测试成功');
  
  // 创建测试文件
  const tempDir = path.join(os.tmpdir(), 'poco-worker-test');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const testFilePath = path.join(tempDir, 'test.txt');
  const testContent = `测试内容 ${new Date().toISOString()}`;
  fs.writeFileSync(testFilePath, testContent);
  
  console.log(`创建测试文件: ${testFilePath}`);
  
  try {
    // 测试上传文件
    console.log('测试上传文件...');
    const cid = await ipfsService.uploadFile(testFilePath);
    console.log(`文件上传成功，CID: ${cid}`);
    
    // 测试下载文件
    console.log('测试下载文件...');
    const downloadPath = path.join(tempDir, 'downloaded.txt');
    const downloadedFilePath = await ipfsService.downloadFile(cid, downloadPath);
    console.log(`文件下载成功: ${downloadedFilePath}`);
    
    // 验证内容
    const downloadedContent = fs.readFileSync(downloadPath, 'utf-8');
    if (downloadedContent === testContent) {
      console.log('内容验证成功: 上传和下载的内容一致');
    } else {
      console.error('内容验证失败: 上传和下载的内容不一致');
      console.log(`原始内容: ${testContent}`);
      console.log(`下载内容: ${downloadedContent}`);
    }
    
  } catch (error) {
    console.error('测试过程中出错:', error);
  }
  
  console.log('IPFS服务测试完成');
}

testIPFSService().catch(console.error);