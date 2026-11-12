import type { Art } from '../signature/layout';
import type { Scene } from '../signature/render';

export interface WebmJob {
  scene: Scene;
  art: Art;
  fps: number;
  duration: number;
  onProgress?: (done: number, total: number) => void;
  cancel?: { value: boolean };
}

export interface WebmResult {
  blob: Blob;
  frames: number;
  mime: string;
}

const MIMES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function pickWebmMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIMES) if (MediaRecorder.isTypeSupported(m)) return m;
  return null;
}

/**
 * 回退路线：Safari 或没有 WebCodecs 时，用 MediaRecorder 实时录一遍 canvas。
 * 这是草稿格式——掉帧、非 MP4，UI 上必须明确标注。
 */
export async function exportWebm(job: WebmJob): Promise<WebmResult> {
  const mime = pickWebmMime();
  if (!mime) throw new Error('NO_MEDIARECORDER');

  const { art, scene, fps } = job;
  const total = Math.max(1, Math.round(job.duration * fps));
  const canvas = document.createElement('canvas');
  canvas.width = art.W;
  canvas.height = art.H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  scene.draw(ctx, 0, { quality: 'hi' });

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: Math.round(art.W * art.H * fps * 0.14),
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  const done = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('RECORDER_ERROR'));
  });

  recorder.start(250);
  const start = performance.now();
  let frame = 0;

  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (job.cancel?.value) {
        recorder.stop();
        reject(new Error('CANCELLED'));
        return;
      }
      const elapsed = (performance.now() - start) / 1000;
      const t = Math.min(1, elapsed / job.duration);
      scene.draw(ctx, t, { quality: 'hi' });
      frame = Math.min(total, Math.floor(t * total));
      job.onProgress?.(frame, total);
      if (t >= 1) {
        // 多给两帧，避免收尾被切掉
        setTimeout(() => {
          recorder.stop();
          resolve();
        }, 120);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await done;
  return { blob: new Blob(chunks, { type: mime }), frames: frame, mime };
}
