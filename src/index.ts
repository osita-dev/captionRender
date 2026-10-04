import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { transcribeToWords } from './transcribe';
import { burnCaptionsWithProgress } from './render';
import { createJob, updateJob } from './supabase';
import type { Job, RenderRequest } from './types';

const app = new Hono();

// CORS
app.use(
  '*',
  cors({
    origin: 'https://captionrenderr.vercel.app',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
  })
)

const UPLOAD_DIR = './uploads';
const OUTPUT_DIR = './outputs';
const MAX_FILE_SIZE = 500 * 1024 * 1024;

// Ensure folders exist
await mkdir(UPLOAD_DIR, { recursive: true });
await mkdir(OUTPUT_DIR, { recursive: true });
console.log('✅ Folders ready');

const jobs = new Map<string, Job>();

// Auto-delete local files after 1 hour
function scheduleCleanup(jobId: string, inputPath: string, outputPath?: string) {
  setTimeout(async () => {
    await Bun.file(inputPath).unlink().catch(() => { });
    if (outputPath) await Bun.file(outputPath).unlink().catch(() => { });
    console.log(`🧹 Cleaned up files for job ${jobId}`);
  }, 60 * 60 * 1000); // 1 hour
}

// Transcription is handled by Groq API — no preload needed

// ─── COMPRESS ENDPOINT ───
app.post('/api/compress', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('video');

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No video file in request' }, 400);
    }

    const videoFile = file as File;
    const jobId = crypto.randomUUID();
    const ext = extname(videoFile.name) || '.mp4';
    const inputPath = join(UPLOAD_DIR, `compress_${jobId}${ext}`);
    const outputPath = join(OUTPUT_DIR, `compressed_${jobId}.mp4`);

    // Save uploaded file
    const bytes = await videoFile.arrayBuffer();
    await Bun.write(inputPath, bytes);

    console.log(`🗜️ Compressing: ${videoFile.name} (${(videoFile.size / (1024 * 1024)).toFixed(1)}MB)`);

    // Compress with FFmpeg — target ~60MB
    const proc = Bun.spawn([
      'ffmpeg', '-y', '-i', inputPath,
      '-vcodec', 'libx264', '-crf', '28', '-preset', 'fast',
      '-acodec', 'aac', '-b:a', '128k',
      outputPath
    ]);

    const exitCode = await proc.exited;

    // Clean up input file
    await Bun.file(inputPath).unlink().catch(() => { });

    if (exitCode !== 0) {
      return c.json({ error: 'Compression failed' }, 500);
    }

    // Return compressed file
    const compressedFile = Bun.file(outputPath);
    const compressedSize = (await compressedFile.size) / (1024 * 1024);
    console.log(`✅ Compressed: ${compressedSize.toFixed(1)}MB`);

    return new Response(compressedFile.stream(), {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="compressed_${videoFile.name}"`,
      },
    });
  } catch (err) {
    console.error('❌ Compress error:', err);
    return c.json({ error: 'Compression failed', details: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ─── UPLOAD ENDPOINT ───
app.post('/api/upload', async (c) => {
  console.log('📥 Upload started');

  try {
    const formData = await c.req.formData();
    const file = formData.get('video');

    console.log('📋 File received:', file ? `YES - ${(file as File).name}` : 'NO');

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No video file in request' }, 400);
    }

    const videoFile = file as File;

    if (videoFile.size > MAX_FILE_SIZE) {
      return c.json({ error: 'File too large (max 500MB)' }, 413);
    }

    const jobId = crypto.randomUUID();
    const ext = extname(videoFile.name) || '.mp4';
    const localPath = join(UPLOAD_DIR, `${jobId}${ext}`);

    console.log(`💾 Saving to local disk: ${localPath}`);

    // Save to local disk
    const bytes = await videoFile.arrayBuffer();
    await Bun.write(localPath, bytes);

    console.log(`✅ Saved: ${bytes.byteLength} bytes`);

    const job: Job = {
      id: jobId,
      fileName: videoFile.name,
      fileSize: videoFile.size,
      duration: 0,
      status: 'uploading',
      progress: 100,
      createdAt: new Date().toISOString(),
      inputPath: localPath,
    };

    // Save metadata to Supabase
    await createJob({
      id: jobId,
      file_name: videoFile.name,
      file_size: videoFile.size,
      status: 'uploading',
      progress: 100,
      input_path: localPath,
      created_at: new Date().toISOString(),
    });
    jobs.set(jobId, job);

    // Start transcription
    process.nextTick(() => transcribeJob(jobId));

    return c.json(job);

  } catch (err) {
    console.error('❌ UPLOAD ERROR:', err);
    return c.json({
      error: 'Upload failed',
      details: err instanceof Error ? err.message : String(err)
    }, 500);
  }
});

// ─── TRANSCRIBE ───
async function transcribeJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  try {
    job.status = 'transcribing';
    job.progress = 10;
    console.log(`[${jobId}] 🎙️ Extracting audio...`);

    // Video is already on local disk
    const localVideoPath = job.inputPath;
    const audioPath = localVideoPath.replace(/\.[^.]+$/, '.wav');
    await Bun.spawn([
      'ffmpeg', '-y', '-i', localVideoPath,
      '-vn', '-ac', '1', '-ar', '16000', audioPath
    ]).exited;

    job.progress = 30;
    console.log(`[${jobId}] ⏱️ Getting duration...`);

    const durProc = Bun.spawn([
      'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', job.inputPath
    ]);
    const durOutput = await new Response(durProc.stdout).text();
    job.duration = parseFloat(durOutput.trim()) || 30;

    job.progress = 40;
    console.log(`[${jobId}] 📝 Transcribing...`);

    job.words = await transcribeToWords(audioPath);
    job.progress = 100;
    job.status = 'ready';
    console.log(`[${jobId}] ✅ Ready — ${job.words.length} words`);

    await Bun.file(audioPath).unlink().catch(() => { });
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : 'Transcription failed';
    console.error(`[${jobId}] ❌ Error:`, err);
  }
}

// ─── GET TRANSCRIPT STATUS ───
app.get('/api/transcribe/:jobId', async (c) => {
  const job = jobs.get(c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);

  if (job.status === 'uploading' || job.status === 'transcribing') {
    return c.json({ status: job.status, progress: job.progress, words: null });
  }
  if (job.status === 'error') {
    return c.json({ status: 'error', error: job.error }, 500);
  }
  return c.json({ status: 'ready', progress: 100, words: job.words, duration: job.duration });
});

// ─── RENDER ───
app.post('/api/render', async (c) => {
  try {
    const { jobId, words, style } = await c.req.json() as RenderRequest;
    const job = jobs.get(jobId);
    if (!job) return c.json({ error: 'Job not found' }, 404);
    if (!words?.length) return c.json({ error: 'No captions to render' }, 400);

    job.status = 'rendering';
    job.progress = 0;
    job.style = style;

    const outputPath = join(OUTPUT_DIR, `${jobId}_captioned.mp4`);

    // Render with progress tracking
    await burnCaptionsWithProgress(job, job.inputPath, outputPath, words, style);

    // Save output to local disk
    job.outputPath = outputPath;
    job.downloadUrl = `/api/download/${jobId}`;
    job.status = 'completed';
    job.progress = 100;

    // Update metadata in Supabase
    await updateJob(jobId, {
      status: 'completed',
      progress: 100,
      output_path: outputPath,
    });

    // Schedule auto-delete of local files
    scheduleCleanup(jobId, job.inputPath, outputPath);

    return c.json(job);
  } catch (err) {
    console.error('❌ Render error:', err);
    return c.json({ error: 'Render failed', details: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ─── DOWNLOAD ───
app.get('/api/download/:jobId', async (c) => {
  const job = jobs.get(c.req.param('jobId'));
  if (!job?.outputPath) return c.json({ error: 'Not ready' }, 404);
  const file = Bun.file(job.outputPath);
  if (!await file.exists()) return c.json({ error: 'File missing' }, 404);
  return new Response(file.stream(), {
    headers: {
      'Content-Disposition': `attachment; filename="${job.fileName.replace(/\.[^.]+$/, '')}_captioned.mp4"`,
      'Content-Type': 'video/mp4',
    },
  });
});

// ─── STREAM VIDEO ───
app.get('/api/video/:jobId', async (c) => {
  const job = jobs.get(c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const file = Bun.file(job.inputPath);
  if (!await file.exists()) return c.json({ error: 'File missing' }, 404);
  return new Response(file.stream(), {
    headers: { 'Content-Type': 'video/mp4' },
  });
});

// ─── HEALTH CHECK ───
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── GET JOB ───
app.get('/api/job/:jobId', (c) => {
  const job = jobs.get(c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  return c.json(job);
});

const port = Number(process.env.PORT || 3001);
console.log(`\n🚀 Server running on port ${port}\n`);

export default { port, fetch: app.fetch };