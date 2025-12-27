'use client';
import { useState, useRef } from 'react';
import DrawCanvas from "./DrawCanvas";
import { CanvasOption } from './settings/canvasOptions';
import TextEditModal from './components/textEditModal';
import { littlePrince } from './settings/examples';
import InfoModal from './components/infoModal';

export default function Home() {
  const [passageText, setPassageText] = useState<string | undefined>(littlePrince.text);
  const [passageHeader, setPassageHeader] = useState<string | undefined>(littlePrince.header);
  const [canvasOption, setCanvasOption] = useState<CanvasOption | null>(null)
  const [modalOpen, setModalOpen] = useState<boolean>(false); 
  const [infoOpen, setInfoOpen] = useState<boolean>(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);

  //download canvasRef and bgRef as one PNG
  const exportCanvasHandler = () => {
    if (canvasRef.current && bgRef.current) {
      const exportCanvas = document.createElement('canvas');
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) return;

      exportCanvas.width = bgRef.current.width;
      exportCanvas.height = bgRef.current.height;

      //draw bgRef first
      ctx.drawImage(bgRef.current, 0, 0);
      //then draw canvasRef on top
      ctx.drawImage(canvasRef.current, 40, 100);

      const link = document.createElement('a');
      link.download = passageHeader ? `${passageHeader}-textellation.png` : 'textellation.png';
      link.href = exportCanvas.toDataURL();
      link.click();
    }
  }

  return (
    <div className="flex flex-col w-[100svw] h-[100svh] items-center justify-center bg-neutral-900 text-neutral-200 overflow-hidden">
      {(passageText && passageHeader && canvasRef && bgRef && canvasOption) &&
        <DrawCanvas passageText={passageText} passageHeader={passageHeader} canvasOption={canvasOption} canvasRef={canvasRef} bgRef={bgRef}/>
      }
        <TextEditModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
          }}
          onSave={(text, header, canvasOption) => {
            setPassageText(text);
            setPassageHeader(header);
            setCanvasOption(canvasOption)
            setModalOpen(false);
          }}
        />
        <InfoModal
          isOpen={infoOpen}
          closeModule={() => {
            setInfoOpen(false);
          }}
        />
        <div className='absolute top-0 pt-3 px-4 w-full flex flex-row gap-2 justify-center items-between'>
            <button
            onClick={() => {
              setInfoOpen(true);
            }}
            >
                textellation_.*🟅
            </button>
            <div className='w-8'/>
          {/* <button
            onClick={() => {
              setInfoOpen(true);
            }}
          >
            info
          </button> */}
          <button
            onClick={() => {
              setModalOpen(true);
            }} 
          >
            {'<edit>'}
          </button>
          <h5>-</h5>
          <button
            onClick={exportCanvasHandler}
          >
            {'<download image>'}
          </button>
        </div>
    </div>
  );
}
