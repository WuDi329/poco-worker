// transcoder.ts
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { TaskData, TranscodingRequirement } from "./types";

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
      console.log("开始转码:", inputPath);
      console.log("转码要求:", JSON.stringify(requirements, null, 2));

      // 确保输出目录存在
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 构建FFmpeg命令参数
      const args = this.buildFFmpegArgs(inputPath, outputPath, requirements);

      console.log("FFmpeg命令:", "ffmpeg", args.join(" "));

      // 启动FFmpeg进程
      const ffmpeg = spawn("ffmpeg", args);

      // 收集标准输出和错误
      let stdout = "";
      let stderr = "";

      ffmpeg.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      ffmpeg.stderr.on("data", (data) => {
        const output = data.toString();
        stderr += output;

        // 转码进度检测
        // FFmpeg将进度信息输出到stderr
        if (output.includes("time=")) {
          const match = output.match(/time=([0-9:.]+)/);
          if (match) {
            console.log(`转码进度: ${match[1]}`);
          }
        }
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          console.log("转码完成:", outputPath);
          resolve(true);
        } else {
          console.error("转码失败，退出码:", code);
          console.error("FFmpeg stderr:", stderr);
          reject(new Error(`转码失败，退出码: ${code}`));
        }
      });

      ffmpeg.on("error", (err) => {
        console.error("启动FFmpeg进程失败:", err);
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
      "-i",
      inputPath, // 输入文件
      "-y", // 覆盖输出文件
      "-v",
      "warning", // 仅显示警告和错误
    ];

    // 添加视频编解码器设置
    switch (requirements.target_codec.toLowerCase()) {
      case "h264":
        args.push("-c:v", "libx264");
        args.push("-preset", "medium");
        args.push("-force_key_frames", "source"); // 关键帧和source保持一致
        args.push("-enc_time_base", "-1"); // 使用统一的时间基
        // 对于x264的GOP设置
        args.push("-x264-params", "min-keyint=1:no-scenecut=1:closed-gop=1");
        break;
      case "hevc":
      case "h265":
        args.push("-c:v", "libx265");
        args.push("-preset", "medium");
        args.push("-force_key_frames", "source"); // 关键帧和source保持一致
        args.push("-enc_time_base", "-1"); // 使用统一的时间基
        // 对于x265的GOP设置
        args.push("-x265-params", "min-keyint=1:no-scenecut=1:closed-gop=1");
        break;
      default:
        args.push("-c:v", "libx264"); // 默认使用H.264
        break;
    }

    // 设置比特率（如果指定）
    if (requirements.target_bitrate && requirements.target_bitrate !== "") {
      args.push("-b:v", requirements.target_bitrate);
    }

    // 设置分辨率（如果指定且不同于"保持不变"）
    if (
      requirements.target_resolution &&
      requirements.target_resolution !== "" &&
      requirements.target_resolution.toLowerCase() !== "original"
    ) {
      args.push("-s", requirements.target_resolution);
    }

    // 设置帧率（如果指定且不同于"保持不变"）
    if (
      requirements.target_framerate &&
      requirements.target_framerate !== "" &&
      requirements.target_framerate.toLowerCase() !== "original"
    ) {
      args.push("-r", requirements.target_framerate);
    }

    // 音频设置 - 默认保持不变
    args.push("-c:a", "copy");

    // 复制字幕流（如果有）
    args.push("-c:s", "copy");

    // 添加额外参数（如果有）
    if (
      requirements.additional_params &&
      requirements.additional_params !== ""
    ) {
      const additionalParams = requirements.additional_params.split(" ");
      args.push(...additionalParams);
    }

    // 输出文件
    args.push(outputPath);

    return args;
  }

  /**
   * 获取视频时长（以秒为单位）
   * @param filePath 视频文件路径
   * @returns 视频时长（秒）
   */
  async getVideoDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const args = [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        filePath,
      ];

      const ffprobe = spawn("ffprobe", args);

      let output = "";

      ffprobe.stdout.on("data", (data) => {
        output += data.toString();
      });

      ffprobe.on("close", (code) => {
        if (code === 0) {
          try {
            const info = JSON.parse(output);
            const duration = parseFloat(info.format.duration);
            resolve(duration);
          } catch (error) {
            if (error instanceof Error) {
              reject(new Error(`解析FFprobe输出失败: ${error.message}`));
            } else {
              reject(new Error(`解析FFprobe输出失败: ${String(error)}`));
            }
          }
        } else {
          reject(new Error(`获取视频时长失败，退出码: ${code}`));
        }
      });

      ffprobe.on("error", (err) => {
        reject(new Error(`启动FFprobe进程失败: ${err.message}`));
      });
    });
  }

  /**
   * 使用 MediaInfo 获取视频的总帧数
   * @param filePath 视频文件路径
   * @returns 视频的总帧数
   */
  async getVideoFrameCount(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      // 使用--Inform参数直接获取帧数
      const args = ["--Inform=Video;%FrameCount%", filePath];

      const mediainfo = spawn("mediainfo", args);

      let output = "";
      mediainfo.stdout.on("data", (data) => {
        output += data.toString();
      });

      let errorOutput = "";
      mediainfo.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      mediainfo.on("close", (code) => {
        if (code === 0) {
          try {
            // 清理输出（去除空白字符）
            const frameCountStr = output.trim();

            // 检查是否有有效输出
            if (frameCountStr && frameCountStr !== "") {
              const frameCount = parseInt(frameCountStr);

              if (!isNaN(frameCount)) {
                resolve(frameCount);
              } else {
                reject(new Error(`无法解析帧数: "${frameCountStr}"`));
              }
            } else {
              // 如果MediaInfo没有返回帧数，尝试使用替代方法
              reject(new Error("MediaInfo未返回帧数信息，尝试使用替代方法"));
            }
          } catch (error) {
            if (error instanceof Error) {
              reject(new Error(`解析MediaInfo输出失败: ${error.message}`));
            } else {
              reject(new Error(`解析MediaInfo输出失败: ${String(error)}`));
            }
          }
        } else {
          reject(
            new Error(
              `MediaInfo执行失败，退出码: ${code}, 错误: ${errorOutput}`
            )
          );
        }
      });

      mediainfo.on("error", (err) => {
        reject(new Error(`启动MediaInfo进程失败: ${err.message}`));
      });
    });
  }

  /**
   * 提取视频的关键帧时间戳
   * @param filePath 视频文件路径
   * @returns 关键帧时间戳数组，按升序排列
   */
  async extractKeyframeTimestamps(filePath: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      console.log("开始提取关键帧时间戳:", filePath);

      // 使用ffprobe提取关键帧
      const args = [
        "-v",
        "error", // 只显示错误信息
        "-skip_frame",
        "nokey", // 跳过非关键帧
        "-select_streams",
        "v", // 只选择视频流
        "-show_frames", // 显示帧信息
        "-show_entries",
        "frame=pts_time", // 只显示帧的时间戳
        "-of",
        "csv=p=0", // 输出为CSV格式，不显示属性名
        filePath,
      ];

      console.log("FFprobe命令:", "ffprobe", args.join(" "));

      const ffprobe = spawn("ffprobe", args);

      let output = "";

      ffprobe.stdout.on("data", (data) => {
        output += data.toString();
      });

      ffprobe.stderr.on("data", (data) => {
        console.error("FFprobe错误:", data.toString());
      });

      ffprobe.on("close", (code) => {
        if (code === 0) {
          // 解析输出，获取时间戳
          const timestamps = output
            .trim()
            .split("\n")
            .filter((line) => line.trim() !== "")
            .map((line) => {
              // 提取每行开头的数字部分（时间戳）
              const match = line.trim().match(/^(\d+\.\d+)/);
              return match ? match[1] : line.trim();
            });

          console.log(`提取到 ${timestamps.length} 个关键帧时间戳`);

          // 按数值大小排序
          timestamps.sort((a, b) => parseFloat(a) - parseFloat(b));

          resolve(timestamps);
        } else {
          reject(new Error(`提取关键帧时间戳失败，退出码: ${code}`));
        }
      });

      ffprobe.on("error", (err) => {
        reject(new Error(`启动FFprobe进程失败: ${err.message}`));
      });
    });
  }
}

export default Transcoder;
