import { writeFile, unlink, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { WordTimestamp, CaptionStyle } from './types';
import { groupWords } from './grouping';
import { downloadFromSupabase } from './supabase';

const UPLOAD_DIR = './uploads';

function buildAssSubtitle(words: WordTimestamp[], style: CaptionStyle): string {
  const alignment = style.positionMode === 'free'
    ? style.positionY < 30 ? 8 : style.positionY > 70 ? 2 : 2
    : style.presetPosition === 'top' ? 8
    : style.presetPosition === 'middle' ? 5
    : 2;

  // ASS color format: &HAABBGGRR
  // Alpha: 00 = fully opaque, FF = fully transparent
  // We want opaque text, so alpha = 00
  const hexToAss = (hex: string) => {
    const clean = hex.replace('#', '');
    const r = clean.slice(0, 2), g = clean.slice(2, 4), b = clean.slice(4, 6);
    return `&H00${b}${g}${r}`;
  };

  const textColor = hexToAss(style.fontColor);
  const bgColor = style.backgroundColor.startsWith('#')
    ? hexToAss(style.backgroundColor)
    : '&H00000000';
  const fontSize = Math.round(style.baseFontSize * 1.5);

  // Map custom font names to font file paths (auto-generated from fonts.config.ts)
  const fontFileMap: Record<string, string> = {
    'Scarlet': 'assets/fonts/Scarlet.otf',
    'Catchye': 'assets/fonts/Catchye.otf',
    'Caviar Dreams': 'assets/fonts/CaviarDreams.ttf',
    'Stretch Pro': 'assets/fonts/StretchPro.otf',
    'TS Block': 'assets/fonts/TS Block Bold.ttf',
    'Designer': 'assets/fonts/Designer.otf',
  };

  const fontFile = fontFileMap[style.fontFamily];
  // Use fontsdir as an option inside the ass filter (not a separate filter)
  const assOptions = fontFile ? `:fontsdir='assets/fonts/'` : '';

  const toAssTime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const cs = Math.floor((sec % 1) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${style.fontFamily},${fontSize},${textColor},&H000000FF,&H00000000,${bgColor},0,0,0,0,100,100,0,0,1,2,0,${alignment},20,20,${alignment === 2 ? 30 : alignment === 8 ? 30 : 0},1`,
    // Use custom font file if available, otherwise fallback to system font
    ...(fontFile ? [`Fontname: ${style.fontFamily}`] : []),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  // Group words by phrase for readable captions
  const groups = groupWords(words, style.wordsPerCaption);
  groups.forEach((group) => {
    const text = group.text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
    lines.push(`Dialogue: 0,${toAssTime(group.startTime)},${toAssTime(group.endTime)},Default,,0,0,0,,${text}`);
  });

  return lines.join('\n');
}

export async function burnCaptions(
  inputVideoPath: string,
  outputVideoPath: string,
  words: WordTimestamp[],
  style: CaptionStyle
): Promise<void> {
  // Video is already on local disk
  const localVideoPath = inputVideoPath;

  const assContent = buildAssSubtitle(words, style);
  const assPath = localVideoPath.replace(/\.[^.]+$/, '_captions.ass');
  await writeFile(assPath, assContent, 'utf8');

  try {
    const assPathForward = assPath.replace(/\\/g, '/');

    // Map custom font names to font file paths
    const fontFileMap: Record<string, string> = {
      'Scarlet': 'assets/fonts/Scarlet.otf',
      'Catchye': 'assets/fonts/Catchye.otf',
      'Caviar Dreams': 'assets/fonts/CaviarDreams.ttf',
      'Stretch Pro': 'assets/fonts/StretchPro.otf',
      'TS Block': 'assets/fonts/TS Block Bold.ttf',
      'Designer': 'assets/fonts/Designer.otf',
    };
    const fontFile = fontFileMap[style.fontFamily];
    const assOptions = fontFile ? `:fontsdir='assets/fonts/'` : '';
    const vfFilter = `ass=${assPathForward}${assOptions}`;

    const proc = Bun.spawn([
      'ffmpeg', '-y', '-i', localVideoPath,
      '-vf', vfFilter,
      '-c:v', 'libx264', '-crf', '23', '-preset', 'medium',
      '-c:a', 'copy',
      outputVideoPath
    ]);

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`FFmpeg failed with exit code ${exitCode}`);
    }

    try {
      await access(outputVideoPath);
    } catch {
      throw new Error('Output file was not created');
    }

    console.log(`✅ Rendered: ${outputVideoPath}`);
  } finally {
    await unlink(assPath).catch(() => {});
  }
}

export async function burnCaptionsWithProgress(
  job: { progress: number; duration: number },
  inputVideoPath: string,
  outputVideoPath: string,
  words: WordTimestamp[],
  style: CaptionStyle
): Promise<void> {
  // Video is already on local disk
  const localVideoPath = inputVideoPath;

  const assContent = buildAssSubtitle(words, style);
  const assPath = localVideoPath.replace(/\.[^.]+$/, '_captions.ass');
  await writeFile(assPath, assContent, 'utf8');

  try {
    const assPathForward = assPath.replace(/\\/g, '/');

    // Use fontsdir as an option inside the ass filter
    const fontFileMap: Record<string, string> = {
      'Scarlet': 'assets/fonts/Scarlet.otf',
      'Catchye': 'assets/fonts/Catchye.otf',
      'Caviar Dreams': 'assets/fonts/CaviarDreams.ttf',
      'Stretch Pro': 'assets/fonts/StretchPro.otf',
      'TS Block': 'assets/fonts/TS Block Bold.ttf',
      'Designer': 'assets/fonts/Designer.otf',
    };
    const fontFile = fontFileMap[style.fontFamily];
    const assOptions = fontFile ? `:fontsdir='assets/fonts/'` : '';
    const vfFilter = `ass=${assPathForward}${assOptions}`;

    // Use FFmpeg's built-in progress output for accurate tracking
    const proc = Bun.spawn([
      'ffmpeg', '-y', '-i', inputVideoPath,
      '-vf', vfFilter,
      '-c:v', 'libx264', '-crf', '23', '-preset', 'medium',
      '-c:a', 'copy',
      '-progress', 'pipe:1',
      outputVideoPath
    ], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Parse FFmpeg progress output (key=value format)
    const stdout = proc.stdout;
    if (stdout) {
      const reader = stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastProgress = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse key=value pairs
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const [key, val] = line.split('=');
          if (key === 'out_time_ms') {
            const timeMs = parseInt(val);
            const totalSeconds = timeMs / 1000;
            const estimatedTotal = job.duration || 60;
            const progress = Math.min(99, Math.round((totalSeconds / estimatedTotal) * 100));

            if (progress > lastProgress) {
              job.progress = progress;
              lastProgress = progress;
            }
          }
        }
      }
    }

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`FFmpeg failed with exit code ${exitCode}`);
    }

    try {
      await access(outputVideoPath);
    } catch {
      throw new Error('Output file was not created');
    }

    console.log(`✅ Rendered: ${outputVideoPath}`);
  } finally {
    await unlink(assPath).catch(() => {});
  }
}
