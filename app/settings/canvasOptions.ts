export type CanvasOptionBase = {
  id: string;
  name: string;
  description: string;
  maxParas: number;
  maxWords: number;
  maxWordsPerParagraph: number;
  /** Maximum renderer nodes after the tokenizer expands punctuation. */
  maxNodes: number;
  WORD_SIZE: number;
  GRID_SIZE: number;
};

export type FixedCanvasOption = CanvasOptionBase & {
  kind: "fixed";
  W: number;
  H: number;
  MARGIN: number;
  BG_SIDE_MARGIN: number;
  BG_TOP_MARGIN: number;
  BG_BOTTOM_MARGIN: number;
  HEADER_SIZE: number;
  showTitle: boolean;
  showText: boolean;
};

export type InfiniteCanvasOption = CanvasOptionBase & {
  kind: "infinite";
  /** Preferred starting extent. The bitmap always remains viewport-sized. */
  W: number;
  H: number;
  MARGIN: number;
  MIN_ZOOM: number;
  MAX_ZOOM: number;
};

export type CanvasOption = FixedCanvasOption | InfiniteCanvasOption;

export function isFixedCanvasOption(
  option: CanvasOption,
): option is FixedCanvasOption {
  return option.kind === "fixed";
}

const largePoster: FixedCanvasOption = {
  id: "large-poster",
  kind: "fixed",
  name: "Large Poster",
  description: "for hi-res print",
  maxParas: 9,
  maxWords: 360,
  maxWordsPerParagraph: 90,
  maxNodes: 480,
  W: 2000,
  H: 2800,
  MARGIN: 20,
  GRID_SIZE: 25,
  BG_SIDE_MARGIN: 40,
  BG_TOP_MARGIN: 100,
  BG_BOTTOM_MARGIN: 300,
  WORD_SIZE: 24,
  HEADER_SIZE: 44,
  showTitle: true,
  showText: true,
};

const smallCard: FixedCanvasOption = {
  id: "small-card",
  kind: "fixed",
  name: "Small Card",
  description: "send to loved ones",
  maxParas: 3,
  maxWords: 120,
  maxWordsPerParagraph: 60,
  maxNodes: 180,
  W: 800,
  H: 1100,
  MARGIN: 10,
  GRID_SIZE: 15,
  BG_SIDE_MARGIN: 10,
  BG_TOP_MARGIN: 80,
  BG_BOTTOM_MARGIN: 40,
  WORD_SIZE: 16,
  HEADER_SIZE: 24,
  showTitle: true,
  showText: false,
};

const phoneWallpaper: FixedCanvasOption = {
  id: "wallpaper",
  kind: "fixed",
  name: "Wallpaper",
  description: "fits most smartphones",
  maxParas: 3,
  maxWords: 180,
  maxWordsPerParagraph: 80,
  maxNodes: 260,
  W: 1080,
  H: 1920,
  MARGIN: 20,
  GRID_SIZE: 20,
  BG_SIDE_MARGIN: 0,
  BG_TOP_MARGIN: 0,
  BG_BOTTOM_MARGIN: 0,
  WORD_SIZE: 20,
  HEADER_SIZE: 0,
  showTitle: false,
  showText: false,
};

const smallSquare: FixedCanvasOption = {
  id: "small-square",
  kind: "fixed",
  name: "Small Square",
  description: "e-cards or social posts",
  maxParas: 3,
  maxWords: 180,
  maxWordsPerParagraph: 80,
  maxNodes: 260,
  W: 1200,
  H: 1200,
  MARGIN: 15,
  GRID_SIZE: 15,
  BG_SIDE_MARGIN: 20,
  BG_TOP_MARGIN: 70,
  BG_BOTTOM_MARGIN: 20,
  HEADER_SIZE: 24,
  WORD_SIZE: 20,
  showTitle: true,
  showText: false,
};

const tinyStrip: FixedCanvasOption = {
  id: "tiny-strip",
  kind: "fixed",
  name: "Tiny Strip",
  description: "small keepsakes",
  maxParas: 4,
  maxWords: 100,
  maxWordsPerParagraph: 40,
  maxNodes: 150,
  W: 1300,
  H: 540,
  MARGIN: 15,
  GRID_SIZE: 15,
  BG_SIDE_MARGIN: 10,
  BG_TOP_MARGIN: 70,
  BG_BOTTOM_MARGIN: 20,
  HEADER_SIZE: 24,
  WORD_SIZE: 12,
  showTitle: true,
  showText: false,
};

const infiniteLive: InfiniteCanvasOption = {
  id: "infinite-live",
  kind: "infinite",
  name: "Infinite Live",
  description: "a growing field — drag to pan and scroll to zoom",
  maxParas: 24,
  maxWords: 720,
  maxWordsPerParagraph: 120,
  maxNodes: 960,
  W: 1440,
  H: 960,
  MARGIN: 48,
  GRID_SIZE: 18,
  WORD_SIZE: 22,
  MIN_ZOOM: 0.04,
  MAX_ZOOM: 3.2,
};

export const CANVAS_OPTIONS: CanvasOption[] = [
  largePoster,
  smallCard,
  phoneWallpaper,
  smallSquare,
  tinyStrip,
  infiniteLive,
];
