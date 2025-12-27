// TextEditModal.tsx
import { useState } from 'react';
import { littlePrince, lookingGlass } from '../settings/examples';
import { CANVAS_OPTIONS, CanvasOption } from "../settings/canvasOptions";

const SLACK = 0.78;
const MAX_PARAS = 9;
const MIN_WORDS_PER_PARA = 3;

const INK = '#0B0F16';
const VEIL = '#ffffff20';

function ellipseSizeFromWords(wc: number, W: number) {
  const minS = 18, maxS = 160, mix = 0.45;
  const sLin  = wc * (W / 230);
  const sArea = Math.sqrt(wc) * Math.sqrt(W) * 0.5;
  const s = Math.max(minS, Math.min(maxS, (1 - mix) * sLin + mix * sArea));
  return { rx: 1.5 * s, ry: 1.0 * s };
}
function rectAreaFromWords(wc: number, W: number) {
  const { rx, ry } = ellipseSizeFromWords(wc, W);
  return (2 * rx) * (2 * ry);
}
function estimateCapPerPara(paragraphCount: number, CANVAS_W: number, CANVAS_H: number) {
  const budget = SLACK * CANVAS_W * CANVAS_H;
  let lo = 0, hi = 2000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const area = paragraphCount * rectAreaFromWords(mid, CANVAS_W);
    if (area <= budget) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function preflightBoundFromRawText(raw: string, CANVAS_W: number, CANVAS_H: number) {
  const all = raw
    .split(/\n{2,}/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // Enforce max paragraphs
  const removedParas = Math.max(0, all.length - MAX_PARAS);
  const paras = all.slice(0, MAX_PARAS);

  const budget = SLACK * CANVAS_W * CANVAS_H;
  const uniformCap = paras.length ? estimateCapPerPara(paras.length, CANVAS_W, CANVAS_H) : 0;

  const split = paras.map(p => p.split(' ').filter(Boolean));
  const capped = split.map(t => t.slice(0, uniformCap));

  const totalArea = capped.reduce((a, t) => a + rectAreaFromWords(t.length, CANVAS_W), 0);

  if (totalArea <= budget) {
    const trimmed = split.reduce((z, t, i) => z + Math.max(0, t.length - capped[i].length), 0);
    return {
      boundedText: capped.map(t => t.join(' ')).join('\n\n'),
      trimmedWords: trimmed,
      removedParas,
      ok: true
    };
  }

  // Proportional tighten (don’t go below MIN_WORDS_PER_PARA)
  const cur = capped.map(t => t.slice());
  let over = totalArea - budget;
  let guard = 5000;
  while (over > 0 && guard-- > 0) {
    let bestIdx = -1, bestDelta = 0;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i].length <= MIN_WORDS_PER_PARA) continue;
      const d = rectAreaFromWords(cur[i].length, CANVAS_W) -
                rectAreaFromWords(cur[i].length - 1, CANVAS_W);
      if (d > bestDelta) { bestDelta = d; bestIdx = i; }
    }
    if (bestIdx === -1) break;
    cur[bestIdx].pop();
    over -= bestDelta;
  }

  const trimmed = split.reduce((z, t, i) => z + Math.max(0, t.length - cur[i].length), 0);
  return {
    boundedText: cur.map(t => t.join(' ')).join('\n\n'),
    trimmedWords: trimmed,
    removedParas,
    ok: over <= 0
  };
}

export default function TextEditModal({
  isOpen,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (text: string, header: string, canvasOption: CanvasOption) => void;
}) {
  const [text, setText] = useState<string>(lookingGlass.text);
  const [header, setHeader] = useState<string>(lookingGlass.header);
  const [canvasSetting, setCanvasSetting] = useState<CanvasOption>(CANVAS_OPTIONS[0])

  function handleExampleClick(example: { text: string; header: string }) {
    setText(example.text);
    setHeader(example.header);
  }

  function handleSave() {
    const { boundedText, trimmedWords, removedParas, ok } = preflightBoundFromRawText(text, canvasSetting.W, canvasSetting.H);

    const parts: string[] = [];
    if (removedParas > 0) parts.push(`Removed ${removedParas} extra paragraph${removedParas === 1 ? '' : 's'} (max ${MAX_PARAS}).`);
    if (trimmedWords > 0) parts.push(`Trimmed ${trimmedWords} word${trimmedWords === 1 ? '' : 's'} to fit 2000×2800.`);
    if (!ok) parts.push('Reached minimum paragraph size.');

    onSave(boundedText, header, canvasSetting);
    onClose();
  }

  function handleSettingChange(option: CanvasOption) {
    setCanvasSetting(option);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}>
      <div
        className="w-11/12 max-w-3xl max-h-[80vh] px-6 py-5 overflow-y-auto rounded-2xl shadow-2xl"
        style={{
          background: INK,
          border: `1px solid ${VEIL}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
        }}
      >
          {/* header */}
          <h2
            className="mb-4 text-[13px] tracking-[0.22em] uppercase select-none"
            style={{ color: 'rgba(255,255,255,0.66)' }}
          >
            Edit Passage
          </h2>

          {/* header input */}
          <input
            type="text"
            placeholder="Header"
            value={header}
            onChange={(e) => setHeader(e.target.value)}
            className="w-full mb-3 bg-transparent outline-none"
            style={{
              background: `linear-gradient(to bottom, transparent, ${VEIL})`,
              color: 'rgba(255,255,255,0.90)',
              fontSize: 16,
            }}
          />

          {/* body textarea */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste or type your text…"
            className="w-full h-48 mb-4 outline-none resize-vertical"
            style={{
              background: VEIL,
              color: 'rgba(255,255,255,0.88)',
              padding: 12,
              lineHeight: 1.55,
              fontSize: 15,
            }}
          />

          {/* examples row */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => handleExampleClick(lookingGlass)}
              style={{
                border: `1px solid ${VEIL}`,
                color: 'rgba(255,255,255,0.78)',
              }}
            >
              Through the Looking-Glass
            </button>
            <button
              onClick={() => handleExampleClick(littlePrince)}
              style={{
                border: `1px solid ${VEIL}`,
                color: 'rgba(255,255,255,0.78)',
              }}
            >
              The Little Prince
            </button>
          </div>

          {/* canvas settings */}
          <div className='w-full flex flex-col gap-1'>
            <h2
              className="mb-4 text-[13px] tracking-[0.22em] uppercase select-none"
              style={{ color: 'rgba(255,255,255,0.66)' }}
            >
              Canvas Options
            </h2>
            <div className='w-full flex flex-row gap-2'>
              {
                CANVAS_OPTIONS.map((option) => 
                  <button
                    key={option.name}
                    style={{
                      border: `1px solid ${VEIL}`,
                      background: (option == canvasSetting ? 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))' : 'transparent'),
                      color: (option == canvasSetting ? "white" : 'rgba(255,255,255,0.78)'),
                    }}
                    onClick={() => handleSettingChange(option)}
                  >
                    {option.name}
                  </button>
                )
              }
            </div>
          </div>

          {/* actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              style={{
                border: `1px solid ${VEIL}`,
                color: 'rgba(255,255,255,0.72)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              style={{
                border: `1px solid ${VEIL}`,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))',
                color: 'rgba(255,255,255,0.92)',
              }}
            >
              Save
            </button>
        </div>
      </div>
    </div>
  );
}