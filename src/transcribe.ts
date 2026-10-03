import type { WordTimestamp } from './types';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Transcribe audio using Groq Whisper API.
 * Returns word-level timestamps.
 */
export async function transcribeToWords(audioPath: string): Promise<WordTimestamp[]> {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set. Add it to your .env file.');
  }

  console.log(`🎙️ Calling Groq Whisper API: ${audioPath}`);

  // Read the audio file
  const file = Bun.file(audioPath);
  const buffer = await file.arrayBuffer();

  // Build multipart form data
  const formData = new FormData();
  formData.append('file', new Blob([buffer]), 'audio.wav');
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  if (!result.words || result.words.length === 0) {
    console.log('⚠️ No speech detected in audio');
    return [];
  }

  console.log(`✅ Groq transcription complete: ${result.words.length} words`);

  return result.words.map((word: { word: string; start: number; end: number }, i: number) => ({
    id: `w${i + 1}`,
    text: word.word,
    startTime: word.start,
    endTime: word.end,
  }));
}
