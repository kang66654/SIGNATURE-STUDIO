import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Art } from '../signature/layout';
import type { Scene } from '../signature/render';

export interface ExportJob {
  scene: Scene;
  art: Art;
  fps: number;
  duration: number;
  onProgress?: (done: number, total: number) => void;
  /** 外部可置 true 取消导出 */
  cancel?: { value: boolean };
}

export interface ExportResult {
  blob: Blob;
  frames: number;
  elapsedMs: number;
  codec: string;
}

const CODECS = ['avc1.42001f', 'avc1.4d4028', 'avc1.640028', 'avc1.640032'];

export function hasWebCodecs(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
}

async function pickCodec(width: number, height: number, fps: number): Promise<string | null> {
  if (!hasWebCodecs()) return null;
  for (const codec of CODECS) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        framerate: fps,
        bitrate: Math.round(width * height * fps * 0.14),
      });
      if (support.supported) return codec;
    } catch {
      /* 不支持的编码器直接跳过 */
    }
  }
  return null;
}

/**
 * 离线帧循环导出 MP4。
 * 时间源只有一个：帧号。不读真实时钟，所以同一组参数每次的帧数、时长、画面完全一致。
 */
export async function exportMp4(job: ExportJob): Promise<ExportResult> {
  const { art, scene, fps } = job;
  const duration = job.duration;
  const total = Math.max(1, Math.round(duration * fps));
  const t0 = performance.now();

  const codec = await pickCodec(art.W, art.H, fps);
  if (!codec) throw new Error('NO_WEBCODECS');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: art.W, height: art.H },
    fastStart: 'in-memory',
  });

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (e) {
        encodeError = e as Error;
      }
    },
    error: (e) => {
      encodeError = e as Error;
    },
  });
  encoder.configure({
    codec,
    width: art.W,
    height: art.H,
    framerate: fps,
    bitrate: Math.round(art.W * art.H * fps * 0.14),
    latencyMode: 'quality',
  });

  const canvas = document.createElement('canvas');
  canvas.width = art.W;
  canvas.height = art.H;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  try {
    for (let i = 0; i < total; i++) {
      if (job.cancel?.value) throw new Error('CANCELLED');
      if (encodeError) throw encodeError;
      const t = total === 1 ? 1 : i / (total - 1);
      scene.draw(ctx, t, { quality: 'hi' });
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      // 每秒一个关键帧：拖进度条时不会糊，也便于平台二次转码
      encoder.encode(frame, { keyFrame: i % fps === 0 });
      frame.close();
      job.onProgress?.(i + 1, total);
      // 背压：队列超过 8 帧就让出主线程，否则内存先炸
      while (encoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 0));
        if (job.cancel?.value) throw new Error('CANCELLED');
      }
    }

    await encoder.flush(); // 少这一行，最后一秒的帧会丢
    muxer.finalize();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  if (encodeError) throw encodeError;
  const buffer = (muxer.target as ArrayBufferTarget).buffer;
  return {
    blob: new Blob([buffer], { type: 'video/mp4' }),
    frames: total,
    elapsedMs: performance.now() - t0,
    codec,
  };
}
