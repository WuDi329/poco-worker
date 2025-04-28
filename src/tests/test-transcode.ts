// test-transcoder.ts
import Transcoder from "../transcoder";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { TranscodingRequirement } from "../types";

async function testTranscoder() {
  console.log("开始测试转码服务...");

  // 创建临时目录
  const tempDir = path.join(os.tmpdir(), "poco-worker-test");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // 检查是否提供了测试视频文件
  const testVideoPath = process.argv[2];
  if (!testVideoPath || !fs.existsSync(testVideoPath)) {
    console.error("请提供有效的测试视频文件路径作为参数");
    console.log("示例: npm run test:transcoder -- /path/to/test-video.mp4");
    return;
  }

  const transcoder = new Transcoder();

  try {
    // 获取视频信息
    console.log("获取视频信息...");
    const videoInfo = await transcoder.getVideoDuration(testVideoPath);
    console.log("视频信息:");
    // console.log(JSON.stringify(videoInfo, null, 2));
    console.log(videoInfo);

    // 准备测试转码 H.264 -> H.265
    const outputH265Path = path.join(tempDir, "output-h265.mp4");

    const h265Requirements: TranscodingRequirement = {
      target_codec: "h265",
      target_resolution: "original",
      target_bitrate: "2000k",
      target_framerate: "original",
      additional_params: "",
    };

    console.log("开始测试 H.264 -> H.265 转码...");
    const h265Result = await transcoder.transcode(
      testVideoPath,
      outputH265Path,
      h265Requirements
    );

    if (h265Result) {
      console.log("H.264 -> H.265 转码成功");

      // 检查输出文件
      const h265Info = await transcoder.getVideoDuration(outputH265Path);
      console.log("H.265 输出文件信息:");
      console.log(JSON.stringify(h265Info, null, 2));
    }

    // 准备测试转码 H.265 -> H.264
    const outputH264Path = path.join(tempDir, "output-h264.mp4");

    const h264Requirements: TranscodingRequirement = {
      target_codec: "h264",
      target_resolution: "original",
      target_bitrate: "2000k",
      target_framerate: "original",
      additional_params: "",
    };

    console.log("开始测试 H.265 -> H.264 转码...");
    const h264Result = await transcoder.transcode(
      outputH265Path,
      outputH264Path,
      h264Requirements
    );

    if (h264Result) {
      console.log("H.265 -> H.264 转码成功");

      // 检查输出文件
      const h264Info = await transcoder.getVideoDuration(outputH264Path);
      console.log("H.264 输出文件信息:");
      // console.log(JSON.stringify(h264Info, null, 2));
      console.log(h264Info);
    }

    console.log("转码测试完成");
    console.log(
      `输出文件位置:\nH.265: ${outputH265Path}\nH.264: ${outputH264Path}`
    );
  } catch (error) {
    console.error("测试过程中出错:", error);
  }
}

testTranscoder().catch(console.error);
