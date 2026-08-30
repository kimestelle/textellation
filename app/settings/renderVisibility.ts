import type { CompositionPresetId } from './compositionPresets';

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

export const PRESET_RENDER_VISIBILITY: Record<CompositionPresetId, RenderVisibility> = {
  baseline: {
    grid: true,
    particles: true,
    ellipseSpokes: true,
    ellipses: true,
    ellipseLabels: true,
    ellipseConnectors: true,
    orderEdges: true,
    punctuationEdges: true,
    strongPosEdges: false,
    weakPosEdges: false,
  },
  orbit: {
    grid: true,
    particles: true,
    ellipseSpokes: true,
    ellipses: true,
    ellipseLabels: true,
    ellipseConnectors: true,
    orderEdges: true,
    punctuationEdges: true,
    strongPosEdges: false,
    weakPosEdges: false,
  },
  compression: {
    grid: true,
    particles: false,
    ellipseSpokes: false,
    ellipses: false,
    ellipseLabels: false,
    ellipseConnectors: false,
    orderEdges: false,
    punctuationEdges: false,
    strongPosEdges: false,
    weakPosEdges: false,
  },
  fracture: {
    grid: true,
    particles: false,
    ellipseSpokes: false,
    ellipses: false,
    ellipseLabels: false,
    ellipseConnectors: false,
    orderEdges: false,
    punctuationEdges: false,
    strongPosEdges: true,
    weakPosEdges: true,
  },
  field: {
    grid: true,
    particles: true,
    ellipseSpokes: false,
    ellipses: true,
    ellipseLabels: true,
    ellipseConnectors: false,
    orderEdges: true,
    punctuationEdges: true,
    strongPosEdges: false,
    weakPosEdges: false,
  },
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
