export type AlphaMode = "none" | "binary" | "partial";
export type TransparencyMode = "preserve" | "flatten";
export type ContentMode = "auto" | "photo" | "line-art";
export type QualityClassification =
  | "pixel_exact"
  | "high_fidelity"
  | "acceptable"
  | "limited";

export interface Warning {
  code: string;
  message: string;
}

export interface WebpAnalysis {
  width: number;
  height: number;
  frames: number;
  delays: number[];
  durationMs: number;
  loop: number;
  fileSize: number;
  alphaMode: AlphaMode;
  timingCompatible: boolean;
  paletteCompatible: boolean;
  maxPaletteEntriesPerFrame: number;
  decodedPixelExactPossible: boolean;
  hasIccProfile: boolean;
  warnings: Warning[];
}

export interface JobDocument {
  version: 1;
  jobId: string;
  createdAt: string;
  expiresAt: string;
  originalName: string;
  analysis: WebpAnalysis;
}

export interface AnalyzeResponse {
  jobId: string;
  source: {
    width: number;
    height: number;
    frames: number;
    durationMs: number;
    loop: number;
    fileSize: number;
  };
  compatibility: {
    alphaMode: AlphaMode;
    timingCompatible: boolean;
    paletteCompatible: boolean;
    maxPaletteEntriesPerFrame: number;
    decodedPixelExactPossible: boolean;
    hasIccProfile: boolean;
  };
  warnings: Warning[];
  recommendedOptions: ConvertOptions;
  expiresAt: string;
}

export interface ConvertOptions {
  jobId: string;
  transparencyMode: TransparencyMode;
  background: string;
  alphaThreshold: number;
  contentMode: ContentMode;
}

export interface QualityMetrics {
  classification: QualityClassification;
  psnrDb: number | null;
  meanAbsoluteError: number;
  rootMeanSquareError: number;
  maximumChannelError: number;
  changedPixelRatio: number;
  frameCountPreserved: boolean;
  loopPreserved: boolean;
  durationErrorMs: number;
  maximumFrameDelayErrorMs: number;
}

export type Adaptation =
  | "partial_alpha_thresholded"
  | "partial_alpha_flattened"
  | "binary_transparency_flattened"
  | "timing_quantized"
  | "icc_normalized_to_srgb";

export interface QualityReport {
  version: 1;
  jobId: string;
  generatedAt: string;
  source: AnalyzeResponse["source"];
  options: ConvertOptions;
  outputSize: number;
  quality: QualityMetrics;
  adaptations: Adaptation[];
}

export interface ConvertResponse {
  jobId: string;
  outputUrl: string;
  reportUrl: string;
  outputSize: number;
  quality: QualityMetrics;
  adaptations: Adaptation[];
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
