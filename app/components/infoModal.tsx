type InfoModalProps = {
    isOpen: boolean;
    closeModule: () => void; 
};

export default function InfoModal({ isOpen, closeModule }: InfoModalProps) {
  const INK  = '#0B0F16';
  const VEIL = '#ffffff20';

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
       style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}>
        <div
        className="flex flex-col w-11/12 max-w-3xl max-h-[80vh] px-6 py-5 overflow-y-auto rounded-2xl shadow-2xl"
        style={{
            background: INK,
            border: `1px solid ${VEIL}`,
            boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
        }}
        >
      <button
        className="self-end mb-3"
        style={{
          background: 'rgba(0,0,0,0.35)',
          border: `1px solid ${VEIL}`,
          color: 'rgba(255,255,255,0.80)',
        }}
        onClick={closeModule}
      >
        Close
      </button>

      <h2
        id="info-title"
        className="mb-2 text-[13px] uppercase tracking-[0.22em] select-none"
        style={{ color: 'rgba(255,255,255,0.66)' }}
      >
        textellation
      </h2>
      <p className="mb-2">this is a typographic constellation maker. map words like stars!</p>
      <p className="mb-4">
        made with <span aria-hidden>⁂</span> by{' '}
        <a
          href="https://www.estellekimdev.com/"
          target="_blank"
          rel="noreferrer"
          className="underline"
          style={{ color: '#ffffff80' }}
        >
          estelle kim
        </a>
      </p>

      <p className="mt-2 mb-2 font-semibold">* how to use *</p>
      <ul className="mb-4 list-disc list-inside text-[15px] leading-relaxed">
        <li>
          <span className="underline">paste your passage</span> and add a short header.
        </li>
        <li>
          <span className="underline">export</span> a high-res image when it feels right.
        </li>
      </ul>

      <p className="mt-2 mb-2 font-semibold">* how it works *</p>
      <ol className="mb-4 list-decimal list-inside text-[15px] leading-relaxed">
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
      </ol>

      <div
        className="mt-auto pt-3 text-[12.5px]"
        style={{ borderTop: `1px solid ${VEIL}`, color: 'rgba(255,255,255,0.65)' }}
      >
        <span className="uppercase tracking-[0.18em]">v0.1</span>
      </div>
    </div>
    </div>
  );
}
