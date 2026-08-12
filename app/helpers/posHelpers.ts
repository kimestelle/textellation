import posTagger from 'wink-pos-tagger';

export const POSBuckets = [
  'NOUN', 'VERB', 'ADJ', 'ADV', 'PRON', 'DET', 'ADP', 'CONJ', 'NUM', 'PUNC', 'OTHER'
] as const;

export type POSBucket = typeof POSBuckets[number];

//wink to simplified buckets
function bucketFromWinkPos(pos: string): POSBucket {
  if (
    pos === '.' || pos === ',' || pos === ':' || pos === ';' ||
    pos === '!' || pos === '?' || pos === '`' || pos === "”" ||
    pos === "'" || pos === '``' ||
    pos === '-LRB-' || pos === '-RRB-' || pos === 'SYM'
  ) return 'PUNC';

  if (pos === 'NN' || pos === 'NNS' || pos === 'NNP' || pos === 'NNPS') return 'NOUN';

  if (pos === 'VB' || pos === 'VBD' || pos === 'VBG' || pos === 'VBN' || pos === 'VBP' || pos === 'VBZ')
    return 'VERB';

  if (pos === 'JJ' || pos === 'JJR' || pos === 'JJS') return 'ADJ';

  if (pos === 'RB' || pos === 'RBR' || pos === 'RBS' || pos === 'WRB') return 'ADV';

  if (pos === 'PRP' || pos === 'PRP$' || pos === 'WP' || pos === 'WP$') return 'PRON';

  if (pos === 'DT' || pos === 'PDT' || pos === 'WDT') return 'DET';

  if (pos === 'IN' || pos === 'TO') return 'ADP';

  if (pos === 'CC') return 'CONJ';

  if (pos === 'CD') return 'NUM';

  return 'OTHER';
}

const PUNCT_RE = /^[,.;:!?—–\-()"'`]+$/;
const CACHE_LIMIT = 256;
const tagger = new posTagger();
const sentenceCache = new Map<
  string,
  { tokens: string[]; buckets: POSBucket[] }
>();

//pos tagging pipeline
export function tokenizeAndBucket(sentence: string): { tokens: string[]; buckets: POSBucket[] } {
  const cacheKey = sentence.trim();
  const cached = sentenceCache.get(cacheKey);
  if (cached) {
    sentenceCache.delete(cacheKey);
    sentenceCache.set(cacheKey, cached);
    return cached;
  }

  const tagged = tagger.tagSentence(cacheKey);

  const tokens: string[] = [];
  const buckets: POSBucket[] = [];

  for (const t of tagged) {
    const raw = (t.value ?? '').toString();
    if (!raw) continue;

    tokens.push(raw);

    const isPunct = PUNCT_RE.test(raw);
    if (isPunct) buckets.push('PUNC');
    else buckets.push(bucketFromWinkPos(t.pos));
  }

  const result = { tokens, buckets };
  sentenceCache.set(cacheKey, result);
  if (sentenceCache.size > CACHE_LIMIT) {
    const oldest = sentenceCache.keys().next().value;
    if (oldest !== undefined) sentenceCache.delete(oldest);
  }
  return result;
}
