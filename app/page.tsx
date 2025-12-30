'use client';

import { useMemo, useRef, useState, useCallback } from 'react';
import DrawCanvas from './DrawCanvas';
import { CANVAS_OPTIONS, CanvasOption } from './settings/canvasOptions';
import TextEditModal from './components/textEditModal';
import InfoModal from './components/infoModal';
import { littlePrince } from './settings/examples';

function safeFilename(s: string) {
  return s
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

export default function Home() {
  const [passageText, setPassageText] = useState<string>(littlePrince.text);
  const [passageHeader, setPassageHeader] = useState<string>(littlePrince.header);
  const [canvasOption, setCanvasOption] = useState<CanvasOption>(CANVAS_OPTIONS[0]);

  const [infoOpen, setInfoOpen] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  
  const exportCanvasHandler = useCallback(async () => {
    const fg = canvasRef.current;
    const bg = bgRef.current;
    if (!fg || !bg) return;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = bg.width;
    exportCanvas.height = bg.height;

    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    // 1) background first
    ctx.drawImage(bg, 0, 0);

    // 2) foreground at the SAME offsets you use in layout
    ctx.drawImage(fg, canvasOption.BG_SIDE_MARGIN, canvasOption.BG_TOP_MARGIN);

    // Prefer toBlob for big images
    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.download = `${safeFilename(passageHeader || 'textellation')}.png`;
      link.href = url;
      link.click();

      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [canvasOption, passageHeader]);

  const canRender = useMemo(() => {
    return Boolean(passageText && passageHeader && canvasOption);
  }, [passageText, passageHeader, canvasOption]);

    return (
    <div className="relative w-full h-full bg-neutral-900">
        {/* top bar */}
        <div className="fixed top-0 left-0 z-50 w-full px-5 md:px-24 pt-6 flex justify-between items-start">
        <h2
            className="flex flex-col items-start text-left"
            onClick={() => setInfoOpen(true)}
        >
            textellation_.*&#x2726;
            <span className="hidden md:block text-neutral-400">
            make typographic constellations
            </span>
        </h2>
        </div>

        {/* bottom bar */}
        <div className="fixed bottom-0 left-0 z-50 w-full px-5 md:px-24 pb-3 flex justify-end">
        <a
            href="https://www.estellekimdev.com/"
            target="_blank"
            rel="noreferrer"
            className="text-neutral-400"
        >
            made w/ love by estelle
        </a>
        </div>

        <div className="w-full min-h-[100svh] px-5 md:px-24 pt-24 pb-16">
        <div className="flex flex-col md:flex-row gap-8 w-full h-[calc(100svh-6rem-4rem)]">
            {/* left */}
            <div className="flex-1  min-h-0 flex items-center justify-center">
            {canRender && (
                <DrawCanvas
                passageText={passageText}
                passageHeader={passageHeader}
                canvasOption={canvasOption}
                canvasRef={canvasRef}
                bgRef={bgRef}
                />
            )}
            </div>

            {/* right */}
            <div className="flex-1  min-h-0 overflow-auto">
            <TextEditModal
                onSave={(text, header, option) => {
                setPassageText(text);
                setPassageHeader(header);
                setCanvasOption(option);
                }}
                onDownload={exportCanvasHandler}
            />
            </div>
        </div>
        </div>

        <InfoModal isOpen={infoOpen} closeModule={() => setInfoOpen(false)} />
    </div>
    );

}
