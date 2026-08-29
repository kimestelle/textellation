import { generateStarPattern } from "../helpers/drawHelpers";
type InfoModalProps = {
    isOpen: boolean;
    closeModule: () => void; 
};

export default function InfoModal({ isOpen, closeModule }: InfoModalProps) {
  if (!isOpen) return null;
  return (
    <div 
    onClick={closeModule}
    className="cursor-pointer fixed inset-0 z-50 flex items-center justify-center"
       style={{ background: 'rgba(0,0,0,0.94)' }}>
        <div className="flex flex-col w-11/12 max-w-3xl max-h-[80vh] px-6 py-5 overflow-y-auto">
        <div className='flex flex-row w-full mb-3'>
          <h3>
            textellation_.*&#x2726;
          </h3>
            <span
              className="text-neutral-500 min-w-0 grow overflow-hidden whitespace-nowrap"
              style={{ textOverflow: "clip" }}
              aria-hidden="true"
            >
              {generateStarPattern(200, 0x51a7)}
            </span>
          {/* <button
            className="no-format shrink-0"
            onClick={closeModule}
          >
            {'<close>'}
          </button> */}
      </div>

      <p className="mb-2">this is a typographic constellation maker. map words like stars!</p>
      <p className="mb-4 text-neutral-400">
        <a
          href="https://www.estellekimdev.com/"
          target="_blank"
          rel="noreferrer"
          className="font-semibold underline underline-offset-2"
          onClick={(event) => event.stopPropagation()}
        >
          made w/ love by estelle
        </a>
      </p>

      {/* <p className="mt-2 mb-2 font-semibold">* how to use *</p> */}
      <ul className="text-neutral-400 mb-4 list-disc list-inside text-[15px] leading-relaxed">
        <li>
          <span className="underline">paste your passage</span> and add a short header.
        </li>
        <li>
          <span className="underline">export</span> a high-res image when it feels right.
        </li>
      </ul>

      {/* <p className="mt-2 mb-2 font-semibold">* how it works *</p>
      <ol className="text-neutral-400 mb-4 list-decimal list-inside text-[15px] leading-relaxed">
        <li>
          we count words per paragraph and compute an ellipse size (3:2 ratio) using a mixed linear/area
          model.
        </li>
        <li>
          a tight <span className="underline">uniform scale</span> is found so everything fits the 2000×2800
          canvas without overlap.
        </li>
        <li>
          paragraphs are <span className="underline">rect-packed</span> (reading order bias), then each
          sentence gets a mini-center-of-gravity.
        </li>
        <li>
          words are placed by a light flow layout + relaxation inside each sentence orbit, preserving
          order and avoiding collisions.
        </li>
      </ol> */}

      <div
        className="status-signal mt-auto pt-3 text-[11px]"
      >
        <span className="uppercase tracking-[0.18em]">v1.1</span>
      </div>
    </div>
    </div>
  );
}
