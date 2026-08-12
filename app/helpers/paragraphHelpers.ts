type Size = { rx: number; ry: number };
const BASE_WORD_SIZE = 24;

export type Ellipse = { x: number; y: number; rx: number; ry: number };

function scaleSizes(sizes: Size[], k: number): Size[] {
  return sizes.map(s => ({ rx: s.rx * k, ry: s.ry * k }));
}

function sumRectArea(sizes: Size[]) {
  return sizes.reduce((a, s) => a + (2*s.rx)*(2*s.ry), 0);
}

// find rectangle area from word count (approx)
export function tightPack(
  W: number,
  H: number,
  WORD_SIZE: number,
  baseSizes: Size[],
  packOpts = { gridStep: 20, areaSlack: 0.78, orderBias: 0.25, edgeBias: 0.08 },
  kMinReadability = 0.55,
  iter = 18,
  overshootGrow = 1.002
): { placement: Ellipse[]; k: number } | "FAIL" {
  if (!baseSizes.length) return "FAIL";

  const kWord = WORD_SIZE / BASE_WORD_SIZE;
  const scaled = (kPack: number) => scaleSizes(baseSizes, kWord * kPack);

  // Always prove the readability floor first. An area-derived starting point
  // can still fail geometrically even when this smaller scale is valid.
  let low = kMinReadability;
  let bestK = low;
  let bestPlacement: Ellipse[] | null = null;
  const tryLo = placeEllipsesRectPacked(W, H, scaled(low), packOpts);
  if (tryLo === "TOO_LARGE") return "FAIL";
  bestPlacement = tryLo;

  const tryHi = placeEllipsesRectPacked(W, H, scaled(1), packOpts);
  if (tryHi !== "TOO_LARGE") {
    return { placement: tryHi, k: 1 };
  }

  let high = 1;

  for (let i = 0; i < iter; i++) {
    const mid = (low + high) / 2;
    const attempt = placeEllipsesRectPacked(W, H, scaled(mid), packOpts);
    if (attempt === "TOO_LARGE") high = mid;
    else {
      low = mid;
      bestK = mid;
      bestPlacement = attempt;
    }
  }

  const kTight = bestK * overshootGrow;
  const finalTry = placeEllipsesRectPacked(W, H, scaled(kTight), packOpts);
  if (finalTry !== "TOO_LARGE") return { placement: finalTry, k: kTight };

  return { placement: bestPlacement!, k: bestK };
}

function quantizeUp(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

/**
 * Pack at full readable scale and grow the world until all regions fit.
 * This is for a camera-based surface; the returned extent is never used as a
 * browser canvas backing-store size.
 */
export function growingTightPack(
  preferredWidth: number,
  preferredHeight: number,
  wordSize: number,
  baseSizes: Size[],
): { placement: Ellipse[]; k: 1; width: number; height: number } {
  const wordScale = wordSize / BASE_WORD_SIZE;
  const sizes = scaleSizes(baseSizes, wordScale);
  const step = 80;
  const aspect = preferredWidth / preferredHeight;
  const widest = Math.max(...sizes.map((size) => size.rx * 2));
  const tallest = Math.max(...sizes.map((size) => size.ry * 2));
  const requiredArea = sumRectArea(sizes) / 0.78;

  const shelfFallback = () => {
    const edge = step;
    const gap = step;
    const targetWidth = quantizeUp(
      Math.max(
        preferredWidth,
        widest + edge * 2,
        Math.sqrt(requiredArea * aspect) * 1.25,
      ),
      step,
    );
    let cursorX = edge;
    let cursorY = edge;
    let rowHeight = 0;
    const placement = sizes.map((size) => {
      const width = size.rx * 2;
      const height = size.ry * 2;
      if (
        cursorX > edge &&
        cursorX + width + edge > targetWidth
      ) {
        cursorX = edge;
        cursorY += rowHeight + gap;
        rowHeight = 0;
      }
      const ellipse = {
        x: cursorX + size.rx,
        y: cursorY + size.ry,
        rx: size.rx,
        ry: size.ry,
      };
      cursorX += width + gap;
      rowHeight = Math.max(rowHeight, height);
      return ellipse;
    });
    return {
      placement,
      k: 1 as const,
      width: targetWidth,
      height: quantizeUp(cursorY + rowHeight + edge, step),
    };
  };

  // Dense documents favor a predictable linear world over a long synchronous
  // search. The camera keeps that world navigable without allocating it.
  if (sizes.length > 12) return shelfFallback();

  let width = quantizeUp(
    Math.max(preferredWidth, widest, Math.sqrt(requiredArea * aspect)),
    step,
  );
  let height = quantizeUp(
    Math.max(preferredHeight, tallest, (requiredArea * 1.02) / width),
    step,
  );

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const placement = placeEllipsesRectPacked(width, height, sizes, {
      gridStep: 20,
      areaSlack: 0.78,
      orderBias: 0.25,
      edgeBias: 0.08,
    });
    if (placement !== "TOO_LARGE") {
      return { placement, k: 1, width, height };
    }
    if (width / height <= aspect) width = quantizeUp(width * 1.12 + step, step);
    else height = quantizeUp(height * 1.12 + step, step);
  }

  return shelfFallback();
}

export function ellipseSizeFromWords(
  wc: number,
  W: number,
  opts = { minS: 18, maxS: 160, mix: 0.45 }
) {
  const { minS, maxS, mix } = opts;
  // linear and area blend for scaling
  const sLin  = wc * (W / 230);
  const sArea = Math.sqrt(wc) * Math.sqrt(W) * 0.5;
  const s = Math.max(minS, Math.min(maxS, (1 - mix) * sLin + mix * sArea));
  // 3:2 aspect ratio
  const rx = 1.5 * s;
  const ry = 1.0 * s;
  return { rx, ry };
}

export function placeEllipsesRectPacked(
  W: number,
  H: number,
  sizes: Array<{ rx: number; ry: number }>, // keep input order!
  opts?: {
    gridStep?: number;
    areaSlack?: number;
    orderBias?: number;
    edgeBias?: number;
  }
): Ellipse[] | "TOO_LARGE" {
  const step      = opts?.gridStep  ?? 14;
  const slack     = opts?.areaSlack ?? 0.78;
  const orderBias = opts?.orderBias ?? 0.25;
  const edgeBias  = opts?.edgeBias  ?? 0.08;

  // sum of rectangle areas vs canvas area check
  const sumRectArea = sizes.reduce((a, s) => a + (2*s.rx)*(2*s.ry), 0);
  if (sumRectArea > slack * W * H) return "TOO_LARGE";

  const maxRx = Math.max(...sizes.map(s => s.rx));
  const maxRy = Math.max(...sizes.map(s => s.ry));

  const x0 = maxRx, x1 = W - maxRx;
  const y0 = maxRy, y1 = H - maxRy;

  // scanline candidates (helps reading order)
  let candidates: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      candidates.push({ x, y });
    }
  }

  const placed: Ellipse[] = [];
  
  function rectClearance(x: number, y: number, rx: number, ry: number) {
    // positive clearance: distance to the nearest rectangle edge; negative means overlap
    let minClr = Infinity;
    for (const q of placed) {
      const dx = Math.abs(x - q.x) - (rx + q.rx);
      const dy = Math.abs(y - q.y) - (ry + q.ry);
      const sepX = Math.max(0, dx);
      const sepY = Math.max(0, dy);
      const overlap = dx < 0 && dy < 0;
      if (overlap) return -Infinity;
      const clr = Math.hypot(sepX, sepY); // 0 if just touching
      if (clr < minClr) minClr = clr;
    }
    return minClr === Infinity ? Math.min(x - rx, W - (x + rx), y - ry, H - (y + ry)) : minClr;
  }

  function scoreAt(x: number, y: number, rx: number, ry: number) {
    const clr = rectClearance(x, y, rx, ry);
    if (clr === -Infinity) return -Infinity;

    const edge = Math.min(x - rx, W - (x + rx), y - ry, H - (y + ry));
    const read = 1 - (0.7 * (y / H) + 0.3 * (x / W)); // prefer small y then small x
    return clr + edgeBias * edge + orderBias * read;
  }

  for (const s of sizes) {
    let best: { x: number; y: number; s: number } | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c.x - s.rx < 0 || c.y - s.ry < 0 || c.x + s.rx > W || c.y + s.ry > H) continue;

      const sc = scoreAt(c.x, c.y, s.rx, s.ry);
      if (sc === -Infinity) continue;
      if (!best || sc > best.s) best = { x: c.x, y: c.y, s: sc };
    }

    if (!best) return "TOO_LARGE";

    placed.push({ x: best.x, y: best.y, rx: s.rx, ry: s.ry });

    // local pruning near the chosen spot (axis-aligned radius)
    const killX = s.rx + Math.max(step, Math.min(maxRx, 0.75 * s.rx));
    const killY = s.ry + Math.max(step, Math.min(maxRy, 0.75 * s.ry));
    candidates = candidates.filter((candidate) => {
      const dx = Math.abs(candidate.x - best.x);
      const dy = Math.abs(candidate.y - best.y);
      return dx >= killX || dy >= killY;
    });
  }

  // micro-nudge upward/left if possible (preserve non-overlap)
  const nudgeX = Math.max(2, Math.floor(step / 2));
  const nudgeY = Math.max(2, Math.floor(step / 2));
  const canMove = (e: Ellipse, dx: number, dy: number) => {
    const nx = e.x + dx, ny = e.y + dy;
    if (nx - e.rx < 0 || ny - e.ry < 0 || nx + e.rx > W || ny + e.ry > H) return false;
    for (const q of placed) {
      if (q === e) continue;
      if (Math.abs(nx - q.x) < (e.rx + q.rx) && Math.abs(ny - q.y) < (e.ry + q.ry)) return false;
    }
    e.x = nx; e.y = ny; return true;
  };
  for (const e of placed) {
    canMove(e, 0, -nudgeY);
    canMove(e, -nudgeX, 0);
  }

  return placed;
}
