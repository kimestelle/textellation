import type { CanvasInspection } from '../helpers/inspectionHelpers';

type OrbitPosition = 'top' | 'right' | 'bottom' | 'left';

const positionClasses: Record<OrbitPosition, string> = {
  top: 'bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 justify-center',
  right: 'left-[calc(100%+10px)] top-1/2 -translate-y-1/2 justify-start',
  bottom: 'top-[calc(100%+10px)] left-1/2 -translate-x-1/2 justify-center',
  left: 'right-[calc(100%+10px)] top-1/2 -translate-y-1/2 justify-end',
};

const originClasses: Record<OrbitPosition, string> = {
  top: 'origin-bottom',
  right: 'origin-left',
  bottom: 'origin-top',
  left: 'origin-right',
};

function OrbitLabel({
  position,
  children,
}: {
  position: OrbitPosition;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`absolute flex ${positionClasses[position]}`}
      data-inspection-readout={position}
    >
      <span
        className={`block max-w-44 truncate whitespace-nowrap rounded-full border border-white/45 bg-white/[0.72] px-2.5 py-1 text-[10px] font-normal uppercase leading-none tracking-[0.08em] text-black shadow-[0_1px_6px_rgba(0,0,0,0.28)] backdrop-blur-[3px] ${originClasses[position]}`}
        style={{
          fontFamily: 'var(--font-space-mono)',
          transform: 'scale(var(--inspection-label-scale, 1))',
        }}
      >
        {children}
      </span>
    </div>
  );
}

function positionCode(paragraph: number, sentence: number, word: number) {
  return `P${String(paragraph + 1).padStart(2, '0')} / S${String(sentence + 1).padStart(2, '0')} / W${String(word + 1).padStart(2, '0')}`;
}

function coordinateCode(x: number, y: number) {
  return `X ${Math.round(x)} / Y ${Math.round(y)} PX`;
}

function compactConnection(connection: string) {
  if (connection === 'samePOS') return 'same pos';
  if (connection === 'samePOSWeak') return 'pos weak';
  return connection;
}

export default function InspectionCornerDetails({
  inspection,
}: {
  inspection: CanvasInspection;
}) {
  if (inspection.kind === 'word') {
    const connections = inspection.connectionTypes.length
      ? inspection.connectionTypes.map(compactConnection).join(' + ')
      : 'unlinked';

    return (
      <div
        className="pointer-events-none absolute inset-0 z-[9] overflow-visible opacity-100 transition-opacity duration-150"
        data-inspection-details="word"
      >
        <OrbitLabel position="top">
          {coordinateCode(inspection.anchor.x, inspection.anchor.y)}
        </OrbitLabel>
        <OrbitLabel position="right">
          {inspection.partOfSpeech} / {inspection.style.weight} {inspection.style.italic ? 'italic' : 'roman'}
        </OrbitLabel>
        <OrbitLabel position="bottom">{connections}</OrbitLabel>
        <OrbitLabel position="left">
          {positionCode(
            inspection.paragraphIndex,
            inspection.sentenceIndex,
            inspection.wordIndex,
          )}
        </OrbitLabel>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[9] overflow-visible opacity-100 transition-opacity duration-150"
      data-inspection-details="region"
    >
      <OrbitLabel position="top">
        {coordinateCode(inspection.anchor.x, inspection.anchor.y)}
      </OrbitLabel>
      <OrbitLabel position="right">{inspection.nodeCount} nodes</OrbitLabel>
      <OrbitLabel position="bottom">
        {inspection.sentenceCount} sentence{inspection.sentenceCount === 1 ? '' : 's'}
      </OrbitLabel>
      <OrbitLabel position="left">region</OrbitLabel>
    </div>
  );
}
