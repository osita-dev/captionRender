export interface WordTimestamp {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface CaptionStyle {
  fontFamily: string;
  baseFontSize: number;
  fontColor: string;
  backgroundColor: string;
  positionMode: 'preset' | 'free';
  presetPosition: 'bottom' | 'top' | 'middle';
  positionX: number;
  positionY: number;
  autoFontSize: boolean;
  wordsPerCaption: number;
}

export interface Job {
  id: string;
  fileName: string;
  fileSize: number;
  duration: number;
  status: 'uploading' | 'transcribing' | 'ready' | 'rendering' | 'completed' | 'error';
  progress: number;
  createdAt: string;
  inputPath: string;
  outputPath?: string;
  downloadUrl?: string;
  words?: WordTimestamp[];
  style?: CaptionStyle;
  error?: string;
}

export interface RenderRequest {
  jobId: string;
  words: WordTimestamp[];
  style: CaptionStyle;
}