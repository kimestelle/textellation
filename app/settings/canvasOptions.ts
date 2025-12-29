export type CanvasOption = {
    name: string;
    description: string;

    maxParas: number;

    W: number;
    H: number;

    MARGIN: number;
    GRID_SIZE: number;

    BG_SIDE_MARGIN: number;
    BG_TOP_MARGIN: number;
    BG_BOTTOM_MARGIN: number;

    WORD_SIZE: number;
    HEADER_SIZE: number;

    showTitle: boolean;
    showText: boolean;
}

const largePoster: CanvasOption = {
    name: "Large Poster",
    description: "for hi-res print",

    maxParas: 9,

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
    showText: true
};

const smallCard: CanvasOption = {
    name: "Small Card",
    description: "send to loved ones",

    maxParas: 3,

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
    showText: false
};

const phoneWallpaper: CanvasOption = {
    name: "Wallpaper",
    description: "fits most smartphones",

    maxParas: 3,

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

const smallSquare: CanvasOption = {
    name: "Small Square",
    description: "e-cards or social posts",

    maxParas: 3,

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
    showText: false
};

const tinySquare: CanvasOption = {
    name: "Tiny Strip",
    description: "small keepsakes",

    maxParas: 4,

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
    showText: false
};

export const CANVAS_OPTIONS: CanvasOption[] = [
    largePoster,
    smallCard,
    phoneWallpaper,
    smallSquare,
    tinySquare
];