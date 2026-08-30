import { CanvasOption } from "../settings/canvasOptions";

export default function CanvasOptionPreview({
  option,
  active,
  size = 64,
}: {
  option: CanvasOption;
  active: boolean;
  size?: number;
}) {
  if (option.kind === "infinite") {
    const line = active ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.22)";
    return (
      <div
        className="relative flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <div
          className="relative h-full w-full overflow-hidden"
          style={{
            background: active
              ? "radial-gradient(circle at center, rgba(255,255,255,0.16), rgba(255,255,255,0.02) 68%)"
              : "radial-gradient(circle at center, rgba(255,255,255,0.10), rgba(255,255,255,0.01) 68%)",
            border: "1px dashed rgba(255,255,255,0.22)",
            maskImage: "radial-gradient(circle, black 46%, transparent 78%)",
          }}
        >
          {[25, 50, 75].map((offset) => (
            <div key={`x-${offset}`} className="absolute inset-y-0 w-px" style={{ left: `${offset}%`, background: line }} />
          ))}
          {[25, 50, 75].map((offset) => (
            <div key={`y-${offset}`} className="absolute inset-x-0 h-px" style={{ top: `${offset}%`, background: line }} />
          ))}
          <div
            className="absolute left-1/2 top-1/2 h-5 w-8 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-white/45"
          />
          <div className="absolute left-[18%] top-[22%] h-1 w-1 rounded-full bg-white/65" />
          <div className="absolute right-[18%] top-[36%] h-1 w-1 rounded-full bg-white/65" />
          <div className="absolute bottom-[18%] left-[34%] h-1 w-1 rounded-full bg-white/65" />
        </div>
      </div>
    );
  }

  const exportW = option.W + 2 * option.BG_SIDE_MARGIN;
  const exportH = option.H + option.BG_TOP_MARGIN + option.BG_BOTTOM_MARGIN;

  const leftPct = (option.BG_SIDE_MARGIN / exportW) * 100;
  const topPct = (option.BG_TOP_MARGIN / exportH) * 100;
  const innerWPct = (option.W / exportW) * 100;
  const innerHPct = (option.H / exportH) * 100;

  const textTop = option.BG_TOP_MARGIN + option.H;
  const textTopPct = (textTop / exportH) * 100;
  const textHPct = (option.BG_BOTTOM_MARGIN / exportH) * 100;

  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden="true">
      <div
        className="relative overflow-hidden"
        style={{
          aspectRatio: `${exportW} / ${exportH}`,
          width: exportW / exportH >= 1 ? "100%" : "auto",
          height: exportW / exportH >= 1 ? "auto" : "100%",
          background: active ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.18)",
        }}
      >
        {/* inner panel */}
        <div
          className="absolute "
          style={{
            left: `${leftPct}%`,
            top: `${topPct}%`,
            width: `${innerWPct}%`,
            height: `${innerHPct}%`,
            background: active ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.14)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        />

        {/* header indicator */}
        {option.showTitle && (
          <div
            className="absolute"
            style={{
              left: `${leftPct}%`,
              top: `${(topPct * 0.35)}%`,
              width: `${innerWPct * 0.55}%`,
              height: `6%`,
              background: "rgba(255,255,255,0.22)",
            }}
          />
        )}

        {/* text block indicator */}
        {option.showText && (
          <div
            className="absolute"
            style={{
              left: `${leftPct}%`,
              top: `${textTopPct}%`,
              width: `${innerWPct}%`,
              height: `${textHPct}%`,
            }}
          >
            {/* fake “lines” */}
            <div
              className="absolute left-0 top-[18%] h-[10%] w-[100%]"
              style={{ background: "rgba(255,255,255,0.14)" }}
            />
            <div
              className="absolute left-0 top-[40%] h-[10%] w-[88%]"
              style={{ background: "rgba(255,255,255,0.12)" }}
            />
            <div
              className="absolute left-0 top-[62%] h-[10%] w-[96%]"
              style={{ background: "rgba(255,255,255,0.10)" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
