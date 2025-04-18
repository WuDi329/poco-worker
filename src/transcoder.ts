// transcoder.ts
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TaskData, TranscodingRequirement } from './types';

export class Transcoder {
  /**
   * 执行视频转码
   * @param inputPath 输入文件路径
   * @param outputPath 输出文件路径
   * @param requirements 转码要求
   */
  async transcode(
    inputPath: string, 
    outputPath: string, 
    requirements: TranscodingRequirement
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      console.log('开始转码:', inputPath);
      console.log('转码要求:', JSON.stringify(requirements, null, 2));
      
      // 确保输出目录存在
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // 构建FFmpeg命令参数
      const args = this.buildFFmpegArgs(inputPath, outputPath, requirements);
      
      console.log('FFmpeg命令:', 'ffmpeg', args.join(' '));
      
      // 启动FFmpeg进程
      const ffmpeg = spawn('ffmpeg', args);
      
      // 收集标准输出和错误
      let stdout = '';
      let stderr = '';
      
      ffmpeg.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        
        // 转码进度检测
        // FFmpeg将进度信息输出到stderr
        if (output.includes('time=')) {
          const match = output.match(/time=([0-9:.]+)/);
          if (match) {
            console.log(`转码进度: ${match[1]}`);
          }
        }
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          console.log('转码完成:', outputPath);
          resolve(true);
        } else {
          console.error('转码失败，退出码:', code);
          console.error('FFmpeg stderr:', stderr);
          reject(new Error(`转码失败，退出码: ${code}`));
        }
      });
      
      ffmpeg.on('error', (err) => {
        console.error('启动FFmpeg进程失败:', err);
        reject(err);
      });
    });
  }
  
  /**
   * 构建FFmpeg转码参数
   */
  private buildFFmpegArgs(
    inputPath: string, 
    outputPath: string, 
    requirements: TranscodingRequirement
  ): string[] {
    const args: string[] = [
      '-i', inputPath,     // 输入文件
      '-y',                // 覆盖输出文件
      '-v', 'warning'      // 仅显示警告和错误
    ];
    
    // 添加视频编解码器设置
    switch (requirements.target_codec.toLowerCase()) {
      case 'h264':
        args.push('-c:v', 'libx264');
        args.push('-preset', 'medium');
        args.push('-force_key_frames', 'source');  // 关键帧和source保持一致
        args.push('-enc_time_base', '-1');         // 使用统一的时间基
        // 对于x264的GOP设置
        args.push('-x264-params', 'min-keyint=1:no-scenecut=1:closed-gop=1');
        break;
      case 'hevc':
      case 'h265':
        args.push('-c:v', 'libx265');
        args.push('-preset', 'medium');
        args.push('-force_key_frames', 'source');  // 关键帧和source保持一致
        args.push('-enc_time_base', '-1');         // 使用统一的时间基
        // 对于x265的GOP设置
        args.push('-x265-params', 'min-keyint=1:no-scenecut=1:closed-gop=1');
        break;
      default:
        args.push('-c:v', 'libx264');  // 默认使用H.264
        break;
    }
    
    // 设置比特率（如果指定）
    if (requirements.target_bitrate && requirements.target_bitrate !== '') {
      args.push('-b:v', requirements.target_bitrate);
    }
    
    // 设置分辨率（如果指定且不同于"保持不变"）
    if (requirements.target_resolution && 
        requirements.target_resolution !== '' && 
        requirements.target_resolution.toLowerCase() !== 'original') {
      args.push('-s', requirements.target_resolution);
    }
    
    // 设置帧率（如果指定且不同于"保持不变"）
    if (requirements.target_framerate && 
        requirements.target_framerate !== '' && 
        requirements.target_framerate.toLowerCase() !== 'original') {
      args.push('-r', requirements.target_framerate);
    }
    
    // 音频设置 - 默认保持不变
    args.push('-c:a', 'copy');
    
    // 复制字幕流（如果有）
    args.push('-c:s', 'copy');
    
    // 添加额外参数（如果有）
    if (requirements.additional_params && requirements.additional_params !== '') {
      const additionalParams = requirements.additional_params.split(' ');
      args.push(...additionalParams);
    }
    
    // 输出文件
    args.push(outputPath);
    
    return args;
  }
  
  /**
   * 获取视频信息
   */
  async getVideoInfo(filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'error',
        '-show_format',
        '-show_streams',
        '-print_format', 'json',
        filePath
      ];
      
      const ffprobe = spawn('ffprobe', args);
      
      let output = '';
      
      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      ffprobe.on('close', (code) => {
        if (code === 0) {
          try {
            const info = JSON.parse(output);
            resolve(info);
          } catch (error) {
            if (error instanceof Error) {
              reject(new Error(`解析FFprobe输出失败: ${error.message}`));
            } else {
              reject(new Error(`解析FFprobe输出失败: ${String(error)}`));
            }
          }
        } else {
          reject(new Error(`获取视频信息失败，退出码: ${code}`));
        }
      });
      
      ffprobe.on('error', (err) => {
        reject(new Error(`启动FFprobe进程失败: ${err.message}`));
      });
    });
  }
}

export default Transcoder;