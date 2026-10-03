import type { WordTimestamp } from './types';

export interface CaptionGroup {
  words: WordTimestamp[];
  startTime: number;
  endTime: number;
  text: string;
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
  'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'our', 'their',
]);

const PHRASE_STARTERS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'must',
  'it', 'i', 'you', 'he', 'she', 'we', 'they',
]);

export function groupWords(words: WordTimestamp[], maxWords: number): CaptionGroup[] {
  if (maxWords <= 1) {
    return words.map((word) => ({
      words: [word],
      startTime: word.startTime,
      endTime: word.endTime,
      text: word.text,
    }));
  }

  const groups: CaptionGroup[] = [];
  let currentGroup: WordTimestamp[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const nextWord = words[i + 1];
    currentGroup.push(word);

    const shouldClose = shouldCloseGroup(currentGroup, nextWord, maxWords);

    if (shouldClose || currentGroup.length >= maxWords) {
      groups.push(createGroup(currentGroup));
      currentGroup = [];
    }
  }

  if (currentGroup.length > 0) {
    groups.push(createGroup(currentGroup));
  }

  return groups;
}

function shouldCloseGroup(
  currentGroup: WordTimestamp[],
  nextWord: WordTimestamp | undefined,
  maxWords: number
): boolean {
  if (currentGroup.length >= maxWords) return true;
  if (!nextWord) return true;

  const lastWord = currentGroup[currentGroup.length - 1];
  const timeGap = nextWord.startTime - lastWord.endTime;
  if (timeGap > 0.5) return true;

  const nextText = nextWord.text.toLowerCase();
  if (PHRASE_STARTERS.has(nextText) && currentGroup.length >= 2) return true;

  const lastText = lastWord.text.toLowerCase();
  if (STOP_WORDS.has(lastText) && currentGroup.length >= 2) return true;

  return false;
}

function createGroup(words: WordTimestamp[]): CaptionGroup {
  return {
    words,
    startTime: words[0].startTime,
    endTime: words[words.length - 1].endTime,
    text: words.map((w) => w.text).join(' '),
  };
}
