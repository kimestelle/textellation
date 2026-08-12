import {
  type CanvasOption,
  type FixedCanvasOption,
  isFixedCanvasOption,
} from "../settings/canvasOptions";
import { ellipseSizeFromWords, tightPack } from "./paragraphHelpers";
import type { POSBucket } from "./posHelpers";

const MIN_WORDS_PER_PARAGRAPH = 3;
const MAX_RENDER_CHARACTERS_PER_WORD = 16;

export type BoundTextResult = {
  boundedText: string;
  trimmedWords: number;
  clippedTokens: number;
  removedParas: number;
  ok: boolean;
};

function paragraphsFromRawText(raw: string, option: CanvasOption) {
  const separator = option.kind === "infinite" ? /\n+/ : /\n{2,}/;
  return raw
    .split(separator)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function clipToken(token: string) {
  const characters = Array.from(token);
  const compact = characters.filter((character, index) => {
    if (/[\p{L}\p{N}]/u.test(character)) return true;
    return index === 0 || characters[index - 1] !== character;
  });
  const shortened = compact.length > MAX_RENDER_CHARACTERS_PER_WORD;
  if (!shortened) {
    return { token: compact.join(""), clipped: compact.length !== characters.length };
  }
  return {
    token: `${compact.slice(0, MAX_RENDER_CHARACTERS_PER_WORD).join("")}…`,
    clipped: true,
  };
}

type Tokenizer = (sentence: string) => {
  tokens: string[];
  buckets: POSBucket[];
};

function splitSentences(paragraph: string) {
  return (paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [paragraph])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function rendererNodeCounts(words: string[][], tokenize: Tokenizer) {
  return words.map((paragraph) =>
    splitSentences(paragraph.join(" ")).reduce(
      (total, sentence) => total + tokenize(sentence).tokens.length,
      0,
    ),
  );
}

function fixedNodesFit(nodeCounts: number[], option: FixedCanvasOption) {
  if (!nodeCounts.length) return false;
  const sizes = nodeCounts.map((count) =>
    ellipseSizeFromWords(
      count,
      option.W - 2 * option.MARGIN,
      { minS: 220, maxS: 700, mix: 0.1 },
    ),
  );
  return tightPack(
    option.W - 2 * option.MARGIN,
    option.H - 2 * option.MARGIN,
    option.WORD_SIZE,
    sizes,
    {
      gridStep: Math.max(24, Math.round(option.WORD_SIZE * 1.5)),
      areaSlack: 0.78,
      orderBias: 0.25,
      edgeBias: 0.08,
    },
    0.58,
    10,
    1.0015,
  ) !== "FAIL";
}

function longestReducibleParagraph(words: string[][]) {
  let bestIndex = -1;
  let bestLength = MIN_WORDS_PER_PARAGRAPH;
  for (let index = 0; index < words.length; index += 1) {
    if (words[index].length > bestLength) {
      bestLength = words[index].length;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export async function boundTextForCanvas(
  raw: string,
  option: CanvasOption,
): Promise<BoundTextResult> {
  const allParagraphs = paragraphsFromRawText(raw, option);
  const removedParas = Math.max(0, allParagraphs.length - option.maxParas);
  const accepted = allParagraphs.slice(0, option.maxParas);
  let clippedTokens = 0;
  const originalWordCount = accepted.reduce(
    (total, paragraph) => total + paragraph.split(/\s+/).filter(Boolean).length,
    0,
  );
  const words = accepted.map((paragraph) =>
    paragraph
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, option.maxWordsPerParagraph)
      .map((token) => {
        const clipped = clipToken(token);
        if (clipped.clipped) clippedTokens += 1;
        return clipped.token;
      }),
  );

  let total = words.reduce((sum, paragraph) => sum + paragraph.length, 0);
  while (total > option.maxWords) {
    const index = longestReducibleParagraph(words);
    if (index < 0) break;
    words[index].pop();
    total -= 1;
  }

  // Wink is intentionally loaded only when Generate is pressed, keeping its
  // large lexicon out of the initial page load. This is the exact tokenizer
  // used by both renderers, so punctuation cannot silently multiply work.
  const { tokenizeAndBucket } = await import("./posHelpers");
  let nodeCounts = rendererNodeCounts(words, tokenizeAndBucket);
  let totalNodes = nodeCounts.reduce((sum, count) => sum + count, 0);
  for (let pass = 0; pass < 16 && totalNodes > option.maxNodes; pass += 1) {
    let index = -1;
    let largest = -1;
    for (let candidate = 0; candidate < words.length; candidate += 1) {
      if (
        words[candidate].length > MIN_WORDS_PER_PARAGRAPH &&
        nodeCounts[candidate] > largest
      ) {
        index = candidate;
        largest = nodeCounts[candidate];
      }
    }
    if (index < 0) break;
    const excessRatio = Math.max(0.08, (totalNodes - option.maxNodes) / totalNodes);
    const removable = words[index].length - MIN_WORDS_PER_PARAGRAPH;
    const count = Math.max(
      1,
      Math.min(removable, Math.ceil(words[index].length * excessRatio)),
    );
    words[index].splice(words[index].length - count, count);
    nodeCounts = rendererNodeCounts(words, tokenizeAndBucket);
    totalNodes = nodeCounts.reduce((sum, value) => sum + value, 0);
  }

  let fixedFit = true;
  if (isFixedCanvasOption(option)) {
    // Use the renderer's actual sizing and packer. Trim in bounded batches so
    // validation cannot become another long main-thread task.
    fixedFit = totalNodes <= option.maxNodes && fixedNodesFit(nodeCounts, option);
    for (let pass = 0; pass < 12 && !fixedFit; pass += 1) {
      let reduced = false;
      for (const paragraph of words) {
        const removable = paragraph.length - MIN_WORDS_PER_PARAGRAPH;
        if (removable <= 0) continue;
        const count = Math.max(
          1,
          Math.min(removable, Math.ceil(paragraph.length * 0.14)),
        );
        paragraph.splice(paragraph.length - count, count);
        reduced = true;
      }
      if (!reduced) break;
      nodeCounts = rendererNodeCounts(words, tokenizeAndBucket);
      totalNodes = nodeCounts.reduce((sum, value) => sum + value, 0);
      fixedFit = totalNodes <= option.maxNodes && fixedNodesFit(nodeCounts, option);
    }
  }

  const separator = option.kind === "infinite" ? "\n" : "\n\n";
  const boundedText = words
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => paragraph.join(" "))
    .join(separator);
  const boundedWordCount = words.reduce(
    (sum, paragraph) => sum + paragraph.length,
    0,
  );

  return {
    boundedText,
    trimmedWords: Math.max(0, originalWordCount - boundedWordCount),
    clippedTokens,
    removedParas,
    ok:
      (option.kind === "infinite" && totalNodes <= option.maxNodes) ||
      (words.length > 0 && fixedFit),
  };
}

export function countWordsAndParagraphs(text: string, option: CanvasOption) {
  const paragraphs = paragraphsFromRawText(text, option);
  const wordCount = paragraphs.reduce(
    (total, paragraph) => total + paragraph.split(/\s+/).filter(Boolean).length,
    0,
  );
  return { paragraphs: paragraphs.length, words: wordCount };
}
