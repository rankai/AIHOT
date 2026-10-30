import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { lstat } from "node:fs/promises";
import { z } from "zod";
import { AssetError } from "./assets.ts";

let active = 0;
const Probe = z.object({ format: z.object({ format_name: z.string(), duration: z.coerce.number().positive().finite() }), streams: z.array(z.object({ codec_type: z.string(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), duration: z.coerce.number().positive().optional() })) });
/** Only bounded, local MP4 inspection; no shell, external references, or transcoding. */
export async function probeVideo(file: string) {
  if (!isAbsolute(file) || !(await lstat(file)).isFile()) throw new AssetError(422, "视频必须是本地普通文件");
  if (active >= 2) throw new AssetError(503, "视频检查繁忙，请稍后重试");
  active++;
  try {
    const text = await new Promise<string>((resolve, reject) => execFile(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-protocol_whitelist", "file", "-format_whitelist", "mov", "-show_entries", "format=format_name,duration:stream=codec_type,width,height,duration", "-of", "json", file], { timeout: 10_000, maxBuffer: 128 * 1024, killSignal: "SIGKILL" }, (error, stdout) => error ? reject(new AssetError(422, "无法检查视频，请确认 ffprobe 可用且文件为有效 MP4")) : resolve(stdout)));
    const parsed = Probe.parse(JSON.parse(text)), streams = parsed.streams.filter(s => s.codec_type === "video");
    if (!parsed.format.format_name.split(",").includes("mp4") || streams.length !== 1 || !streams[0]!.width || !streams[0]!.height) throw new Error("Expected one video stream");
    return { durationMs: Math.ceil(parsed.format.duration * 1000), width: streams[0]!.width, height: streams[0]!.height, hasAudio: parsed.streams.some(s => s.codec_type === "audio") };
  } catch (error) { if (error instanceof AssetError) throw error; throw new AssetError(422, "视频元数据无效"); }
  finally { active--; }
}
