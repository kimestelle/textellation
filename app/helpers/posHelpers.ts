import winkPOSTagger from 'wink-pos-tagger';

export const POSBuckets = ['NOUN', 'VERB', 'ADJ', 'ADV', 'PRON', 'DET', 'ADP', 'CONJ', 'NUM', 'PUNC', 'OTHER'] as const;
export type POSBucket = typeof POSBuckets[number];

export function posTagSentences(sentences: string[]): string[][] {
    const tagger = new winkPOSTagger();
    return sentences.map(sentence => {
        const tokens = tagger.tagSentence(sentence);
        return tokens.map(token => token.pos);
    });
}

export function tokenizePreservePunct(sentence: string): string[] {
  return sentence.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?|[,.;:!?—–\-()"'`]+/g) || [];
}

export function posBucket(word: string): POSBucket {
  const punctOnly = /^[,.;:!?—–\-()"'`]+$/.test(word);
  if (punctOnly) return 'PUNC';
  const w = word.replace(/^[("'`]+|[)"'`,.;:!?—–\-]+$/g, '').toLowerCase();
  if (!w) return 'PUNC';
  const verbs = new Set(['be','is','am','are','was','were','been','being','have','has','had','do','does','did','make','go','went','gone','see','saw','seen','think','say','get','got','know','feel','want','need','use','find','give','tell','work','call','try','become','leave','put','keep','let','begin','seem','help','talk','turn','start','play','move','live','believe','hold','bring','happen','write','provide','sit','stand','lose','pay','meet','include','continue','set','learn','change','lead','understand','watch','follow','stop','create','speak','read','allow','add','spend','grow','open','walk','win','offer','remember','love','consider','appear','buy','wait']);
  const dets  = new Set(['the','a','an','this','that','these','those','some','any','each','every','no','few','many','much']);
  const adps  = new Set(['of','in','on','to','for','with','at','from','into','during','including','until','against','among','through','over','before','after','between','under','around','without','within','across','behind','beyond','near','by','off']);
  const conjs = new Set(['and','or','but','nor','so','yet','for','although','though','because','since','if','when','while','whereas','whether']);
  if (verbs.has(w) || /(ed|ing)$/.test(w)) return 'VERB';
  if (dets.has(w)) return 'DET';
  if (adps.has(w)) return 'ADP';
  if (conjs.has(w)) return 'CONJ';
  if (/^\d+([.,]\d+)?$/.test(w)) return 'NUM';
  if (/(ness|ment|tion|sion|ity|ship|ance|ence|er|or|ist|ism|hood|dom|acy)$/.test(w)) return 'NOUN';
  if (/(ous|ful|less|able|ible|al|ic|ish|ive|ary|ory|ant|ent|ern)$/.test(w)) return 'ADJ';
  if (/(ly)$/.test(w)) return 'ADV';
  return 'NOUN';
}
