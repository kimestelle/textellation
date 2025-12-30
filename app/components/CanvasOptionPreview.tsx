import { CanvasOption } from "../settings/canvasOptions";

export default function CanvasOptionPreview({
  option,
  active,
}: {
  option: CanvasOption;
  active: boolean;
}) {
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
    <div className="absolute flex items-center justify-center" style={{ width: 64, height: 64 }}>
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
