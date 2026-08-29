import { punctToASCIIStar } from './drawHelpers';
import type { POSBucket } from './posHelpers';
import type { WordLink, WordLinkKind, WordNode } from './sentenceHelpers';

const WORD_HIT_RADIUS_SCALE = 1.45;

export type InspectionCanvasKind = 'fixed' | 'infinite';

export type WordStyleInspection = {
  family: string;
  weight: number;
  italic: boolean;
  label: string;
};

export type WordInspection = {
  kind: 'word';
  id: string;
  canvasKind: InspectionCanvasKind;
  sourceWord: string;
  renderedWord: string;
  partOfSpeech: POSBucket;
  paragraphIndex: number;
  sentenceIndex: number;
  wordIndex: number;
  style: WordStyleInspection;
  connectionTypes: WordLinkKind[];
  sourceParagraph: string;
  regionNodeCount: number;
  anchor: { x: number; y: number; width: number; height: number };
};

export type RegionInspection = {
  kind: 'region';
  id: string;
  canvasKind: InspectionCanvasKind;
  paragraphIndex: number;
  sourceParagraph: string;
  sentenceCount: number;
  nodeCount: number;
  anchor: { x: number; y: number; rx: number; ry: number };
};

export type CanvasInspection = WordInspection | RegionInspection;

export type InspectableRegion = {
  paragraphIndex: number;
  sourceParagraph: string;
  sentenceCount: number;
  wordSize: number;
  nodes: WordNode[];
  links: WordLink[];
  ellipse: { x: number; y: number; rx: number; ry: number };
  nodesRelativeToEllipse?: boolean;
};

function styleForNode(node: WordNode): WordStyleInspection {
  if (node.punctOnly) {
    return {
      family: 'Star Glyphs',
      weight: 400,
      italic: false,
      label: 'regular 400 · Star Glyphs',
    };
  }
  if (node.isFirstInSentence) {
    return {
      family: 'Newsreader',
      weight: 700,
      italic: true,
      label: 'italic 700 · Newsreader',
    };
  }
  if (node.bucket === 'NOUN') {
    return {
      family: 'Newsreader',
      weight: 600,
      italic: false,
      label: 'regular 600 · Newsreader',
    };
  }
  if (node.bucket === 'ADJ') {
    return {
      family: 'Newsreader',
      weight: 400,
      italic: true,
      label: 'italic 400 · Newsreader',
    };
  }
  if (node.bucket === 'VERB') {
    return {
      family: 'Newsreader',
      weight: 400,
      italic: false,
      label: 'regular 400 · Newsreader',
    };
  }
  return {
    family: 'Newsreader',
    weight: 300,
    italic: false,
    label: 'regular 300 · Newsreader',
  };
}

function absoluteNodePosition(region: InspectableRegion, node: WordNode) {
  return {
    x: (node.x ?? 0) + (region.nodesRelativeToEllipse ? region.ellipse.x : 0),
    y: (node.y ?? 0) + (region.nodesRelativeToEllipse ? region.ellipse.y : 0),
  };
}

function connectionTypesForNode(
  region: InspectableRegion,
  node: WordNode,
) {
  const types = new Set<WordLinkKind>();
  for (const link of region.links) {
    const source = typeof link.source === 'number'
      ? region.nodes[link.source]
      : link.source;
    const target = typeof link.target === 'number'
      ? region.nodes[link.target]
      : link.target;
    if (source === node || target === node) types.add(link.kind);
  }
  return [...types];
}

function inspectWord(
  canvasKind: InspectionCanvasKind,
  region: InspectableRegion,
  node: WordNode,
): WordInspection {
  const position = absoluteNodePosition(region, node);
  const height = (node.isFirstInSentence ? region.wordSize + 4 : region.wordSize) * 1.35;
  return {
    kind: 'word',
    id: `word:${region.paragraphIndex}:${node.s}:${node.w}:${node.raw}`,
    canvasKind,
    sourceWord: node.raw,
    renderedWord: node.punctOnly ? punctToASCIIStar(node.raw) : node.text,
    partOfSpeech: node.bucket,
    paragraphIndex: region.paragraphIndex,
    sentenceIndex: node.s,
    wordIndex: node.w,
    style: styleForNode(node),
    connectionTypes: connectionTypesForNode(region, node),
    sourceParagraph: region.sourceParagraph,
    regionNodeCount: region.nodes.length,
    anchor: {
      x: position.x,
      y: position.y,
      width: Math.max(region.wordSize * 0.75, node.wPx + 8),
      height,
    },
  };
}

function inspectRegion(
  canvasKind: InspectionCanvasKind,
  region: InspectableRegion,
): RegionInspection {
  return {
    kind: 'region',
    id: `region:${region.paragraphIndex}`,
    canvasKind,
    paragraphIndex: region.paragraphIndex,
    sourceParagraph: region.sourceParagraph,
    sentenceCount: region.sentenceCount,
    nodeCount: region.nodes.length,
    anchor: { ...region.ellipse },
  };
}

export function hitTestInspection(
  canvasKind: InspectionCanvasKind,
  regions: InspectableRegion[],
  x: number,
  y: number,
): CanvasInspection | null {
  let nearestWord: { distance: number; region: InspectableRegion; node: WordNode } | null = null;
  for (const region of regions) {
    for (const node of region.nodes) {
      const position = absoluteNodePosition(region, node);
      const halfWidth = Math.max(region.wordSize * 0.5, node.wPx / 2 + 6) * WORD_HIT_RADIUS_SCALE;
      const halfHeight = (
        (node.isFirstInSentence ? region.wordSize + 4 : region.wordSize) * 0.8
      ) * WORD_HIT_RADIUS_SCALE;
      const dx = Math.abs(x - position.x);
      const dy = Math.abs(y - position.y);
      if (dx > halfWidth || dy > halfHeight) continue;
      const distance = Math.hypot(dx / halfWidth, dy / halfHeight);
      if (!nearestWord || distance < nearestWord.distance) {
        nearestWord = { distance, region, node };
      }
    }
  }
  if (nearestWord) {
    return inspectWord(canvasKind, nearestWord.region, nearestWord.node);
  }

  let nearestRegion: { distance: number; region: InspectableRegion } | null = null;
  for (const region of regions) {
    const dx = (x - region.ellipse.x) / Math.max(1, region.ellipse.rx);
    const dy = (y - region.ellipse.y) / Math.max(1, region.ellipse.ry);
    const distance = dx * dx + dy * dy;
    if (distance > 1) continue;
    if (!nearestRegion || distance < nearestRegion.distance) {
      nearestRegion = { distance, region };
    }
  }
  return nearestRegion
    ? inspectRegion(canvasKind, nearestRegion.region)
    : null;
}

export function splitPassageParagraphs(text: string) {
  return text
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function sentenceCountForParagraph(paragraph: string) {
  return (paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [paragraph])
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .length;
}
