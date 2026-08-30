export type RenderVisibility = {
  grid: boolean;
  particles: boolean;
  ellipseSpokes: boolean;
  ellipses: boolean;
  ellipseLabels: boolean;
  ellipseConnectors: boolean;
  orderEdges: boolean;
  punctuationEdges: boolean;
  strongPosEdges: boolean;
  weakPosEdges: boolean;
};

export const DEFAULT_RENDER_VISIBILITY: RenderVisibility = {
  grid: true,
  particles: true,
  ellipseSpokes: true,
  ellipses: true,
  ellipseLabels: true,
  ellipseConnectors: true,
  orderEdges: true,
  punctuationEdges: true,
  strongPosEdges: true,
  weakPosEdges: true,
};

export const RENDER_VISIBILITY_GROUPS = [
  {
    label: 'word edges',
    choices: [
      { id: 'orderEdges', label: 'order' },
      { id: 'punctuationEdges', label: 'punctuation' },
      { id: 'strongPosEdges', label: 'POS strong' },
      { id: 'weakPosEdges', label: 'POS weak' },
    ],
  },
  {
    label: 'field layers',
    choices: [
      { id: 'ellipses', label: 'ellipses' },
      { id: 'ellipseSpokes', label: 'spokes' },
      { id: 'ellipseLabels', label: 'numerals' },
      { id: 'ellipseConnectors', label: 'ellipse links' },
      { id: 'particles', label: 'particles' },
      { id: 'grid', label: 'grid' },
    ],
  },
] satisfies Array<{
  label: string;
  choices: Array<{ id: keyof RenderVisibility; label: string }>;
}>;
