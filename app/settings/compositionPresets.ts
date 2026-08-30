export type CompositionPresetId =
  | 'baseline'
  | 'orbit'
  | 'compression'
  | 'fracture'
  | 'field';

export type CompositionDynamics = {
  seed: number;
  regionScale: number;
  sentenceRadius: number;
  sentenceAttraction: number;
  repulsion: number;
  collisionPadding: number;
  orderCohesion: number;
  posCohesion: number;
  containment: number;
  edgeAttraction: number;
  fieldGravity: number;
};

export type CompositionPreset = {
  id: CompositionPresetId;
  label: string;
  description: string;
  dynamics: CompositionDynamics;
};

export const COMPOSITION_PRESETS: Record<CompositionPresetId, CompositionPreset> = {
  baseline: {
    id: 'baseline',
    label: 'Baseline',
    description: 'the original balanced composition',
    dynamics: {
      seed: 1009,
      regionScale: 1,
      sentenceRadius: 1,
      sentenceAttraction: 1,
      repulsion: 1,
      collisionPadding: 1,
      orderCohesion: 1,
      posCohesion: 1,
      containment: 1,
      edgeAttraction: 0,
      fieldGravity: 0,
    },
  },
  orbit: {
    id: 'orbit',
    label: 'Orbit',
    description: 'wider sentence radius · lower density · gentle attraction',
    dynamics: {
      seed: 1601,
      regionScale: 1.18,
      sentenceRadius: 1.34,
      sentenceAttraction: 0.62,
      repulsion: 1.24,
      collisionPadding: 1.12,
      orderCohesion: 0.86,
      posCohesion: 0.82,
      containment: 0.78,
      edgeAttraction: 0,
      fieldGravity: 0,
    },
  },
  compression: {
    id: 'compression',
    label: 'Compression',
    description: 'tight radius · strong paragraph cohesion · high density',
    dynamics: {
      seed: 2603,
      regionScale: 0.78,
      sentenceRadius: 0.72,
      sentenceAttraction: 1.58,
      repulsion: 0.58,
      collisionPadding: 0.68,
      orderCohesion: 1.55,
      posCohesion: 1.18,
      containment: 1.42,
      edgeAttraction: 0,
      fieldGravity: 0,
    },
  },
  fracture: {
    id: 'fracture',
    label: 'Fracture',
    description: 'weak cohesion · stronger POS links · outward edge pull',
    dynamics: {
      seed: 3607,
      regionScale: 1.08,
      sentenceRadius: 1.06,
      sentenceAttraction: 0.34,
      repulsion: 1.16,
      collisionPadding: 0.92,
      orderCohesion: 0.38,
      posCohesion: 2.15,
      containment: 0.52,
      edgeAttraction: 1,
      fieldGravity: 0,
    },
  },
  field: {
    id: 'field',
    label: 'Field',
    description: 'free field · tighter order springs · high repulsion',
    dynamics: {
      seed: 4603,
      regionScale: 1.6,
      sentenceRadius: 1.3,
      sentenceAttraction: 0,
      repulsion: 10,
      collisionPadding: 1.05,
      orderCohesion: 1,
      posCohesion: 0,
      containment: 0,
      edgeAttraction: 0,
      fieldGravity: 1,
    },
  },
};

export const COMPOSITION_PRESET_CHOICES = [
  COMPOSITION_PRESETS.orbit,
  COMPOSITION_PRESETS.compression,
  COMPOSITION_PRESETS.fracture,
  COMPOSITION_PRESETS.field,
];
