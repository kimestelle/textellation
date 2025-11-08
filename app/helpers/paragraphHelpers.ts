type Size = { rx: number; ry: number };

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
  baseSizes: Size[],
  packOpts = { gridStep: 20, areaSlack: 0.78, orderBias: 0.25, edgeBias: 0.08 },
  kMinReadability = 0.55,
  iter = 18,
  overshootGrow = 1.002 
): { placement: Ellipse[]; k: number } | "FAIL" {
  if (!baseSizes.length) return "FAIL";

  const budget = (packOpts.areaSlack ?? 0.78) * W * H;
  const area0  = sumRectArea(baseSizes);

  // Start with an area-based guess
  const kHi = 1;
  let kLo = Math.min(kHi, Math.sqrt(budget / Math.max(1, area0))); // <= 1
  // Respect readability floor
  kLo = Math.max(kLo, kMinReadability);

  // If even kHi works, we’ll push toward 1 in the search anyway
  let bestK = kLo;
  let bestPlacement: Ellipse[] | null = null;

  // Ensure we have a feasible starting point
  const tryLo = placeEllipsesRectPacked(W, H, scaleSizes(baseSizes, kLo), packOpts);
  if (tryLo === "TOO_LARGE") {
    // Not placeable even at the floor
    return "FAIL";
  }
  bestK = kLo;
  bestPlacement = tryLo;

  // If 1 fits, clamp to 1 early
  const tryHi = placeEllipsesRectPacked(W, H, scaleSizes(baseSizes, kHi), packOpts);
  if (tryHi !== "TOO_LARGE") {
    bestK = kHi;
    bestPlacement = tryHi;
  }

  // Binary search for the tightest feasible k
  let lo = bestK;                   // feasible
  let hi = tryHi === "TOO_LARGE" ? kHi : 1; // infeasible or 1
  for (let i = 0; i < iter; i++) {
    const mid = (lo + hi) / 2;
    const attempt = placeEllipsesRectPacked(W, H, scaleSizes(baseSizes, mid), packOpts);
    if (attempt === "TOO_LARGE") {
      hi = mid;
    } else {
      lo = mid;
      bestK = mid;
      bestPlacement = attempt;
    }
  }

  // Tiny overshoot to make it “tight”
  const kTight = Math.min(1, bestK * overshootGrow);
  const finalTry = placeEllipsesRectPacked(W, H, scaleSizes(baseSizes, kTight), packOpts);
  if (finalTry !== "TOO_LARGE") {
    return { placement: finalTry, k: kTight };
  }
  // Fallback to best found
  return { placement: bestPlacement!, k: bestK };
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

export type Ellipse = { x: number; y: number; rx: number; ry: number };

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
  const candidates: { x: number; y: number }[] = [];
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
    for (let i = candidates.length - 1; i >= 0; i--) {
      const dx = Math.abs(candidates[i].x - best.x);
      const dy = Math.abs(candidates[i].y - best.y);
      if (dx < killX && dy < killY) candidates.splice(i, 1);
    }
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

