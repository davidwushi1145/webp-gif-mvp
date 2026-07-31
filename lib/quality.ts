import { IMAGE_LIMITS } from "./config";
import { decodeRgbaFrame } from "./decode-frame";
import { AppError } from "./errors";
import { parseHexColour, transformRgbaInPlace } from "./pixels";
import sharp from "./sharp-runtime";
import type { ConvertOptions, QualityMetrics, WebpAnalysis } from "./types";

interface PixelTotals {
  absoluteError: number;
  squaredError: number;
  comparedChannels: number;
  maximumChannelError: number;
  changedPixels: number;
  comparedPixels: number;
}

export function compareRgbaBuffers(
  expected: Buffer,
  actual: Buffer,
): PixelTotals {
  if (expected.length !== actual.length || expected.length % 4 !== 0) {
    throw new AppError(500, "QUALITY_SIZE_MISMATCH", "质量检测时像素尺寸不一致。");
  }

  const totals: PixelTotals = {
    absoluteError: 0,
    squaredError: 0,
    comparedChannels: 0,
    maximumChannelError: 0,
    changedPixels: 0,
    comparedPixels: expected.length / 4,
  };

  for (let offset = 0; offset < expected.length; offset += 4) {
    const expectedAlpha = expected[offset + 3];
    const actualAlpha = actual[offset + 3];
    let pixelChanged = false;

    if (expectedAlpha === 0 && actualAlpha === 0) {
      totals.comparedChannels += 1;
      continue;
    }

    for (let channel = 0; channel < 4; channel += 1) {
      const difference = Math.abs(expected[offset + channel] - actual[offset + channel]);
      totals.absoluteError += difference;
      totals.squaredError += difference * difference;
      totals.comparedChannels += 1;
      totals.maximumChannelError = Math.max(totals.maximumChannelError, difference);
      pixelChanged ||= difference !== 0;
    }

    if (pixelChanged) totals.changedPixels += 1;
  }

  return totals;
}

function normalizedDelays(delays: readonly number[], frames: number): number[] {
  return frames > 1 && delays.length === frames ? [...delays] : [];
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export async function measureGifQuality(
  inputPath: string,
  gifPath: string,
  analysis: WebpAnalysis,
  options: ConvertOptions,
): Promise<QualityMetrics> {
  const outputMetadata = await sharp(gifPath, {
    animated: true,
    failOn: "warning",
    limitInputPixels: IMAGE_LIMITS.maxTotalPixels,
  }).metadata();

  if (!outputMetadata.width || !outputMetadata.height) {
    throw new AppError(500, "OUTPUT_DECODE_FAILED", "无法读取输出 GIF 尺寸。");
  }

  const outputFrames = outputMetadata.pages ?? 1;
  const outputFrameHeight = outputMetadata.pageHeight ?? outputMetadata.height;
  if (
    outputMetadata.width !== analysis.width ||
    outputFrameHeight !== analysis.height
  ) {
    throw new AppError(500, "OUTPUT_SIZE_CHANGED", "输出 GIF 的尺寸发生了变化。");
  }

  const matchedFrames = Math.min(analysis.frames, outputFrames);
  const background = parseHexColour(options.background);
  const totals: PixelTotals = {
    absoluteError: 0,
    squaredError: 0,
    comparedChannels: 0,
    maximumChannelError: 0,
    changedPixels: 0,
    comparedPixels: 0,
  };

  for (let frame = 0; frame < matchedFrames; frame += 1) {
    const expected = transformRgbaInPlace(
      await decodeRgbaFrame(
        inputPath,
        frame,
        analysis.width,
        analysis.height,
      ),
      options.transparencyMode,
      background,
      options.alphaThreshold,
    );
    const actual = await decodeRgbaFrame(
      gifPath,
      frame,
      analysis.width,
      analysis.height,
    );
    const frameTotals = compareRgbaBuffers(expected, actual);

    totals.absoluteError += frameTotals.absoluteError;
    totals.squaredError += frameTotals.squaredError;
    totals.comparedChannels += frameTotals.comparedChannels;
    totals.maximumChannelError = Math.max(
      totals.maximumChannelError,
      frameTotals.maximumChannelError,
    );
    totals.changedPixels += frameTotals.changedPixels;
    totals.comparedPixels += frameTotals.comparedPixels;
  }

  const unmatchedFrames = Math.abs(analysis.frames - outputFrames);
  if (unmatchedFrames > 0) {
    const unmatchedPixels = unmatchedFrames * analysis.width * analysis.height;
    totals.absoluteError += unmatchedPixels * 4 * 255;
    totals.squaredError += unmatchedPixels * 4 * 255 * 255;
    totals.comparedChannels += unmatchedPixels * 4;
    totals.maximumChannelError = 255;
    totals.changedPixels += unmatchedPixels;
    totals.comparedPixels += unmatchedPixels;
  }

  const meanAbsoluteError = totals.absoluteError / totals.comparedChannels;
  const meanSquaredError = totals.squaredError / totals.comparedChannels;
  const rootMeanSquareError = Math.sqrt(meanSquaredError);
  const psnrDb =
    rootMeanSquareError === 0
      ? null
      : 20 * Math.log10(255 / rootMeanSquareError);
  const changedPixelRatio = totals.changedPixels / totals.comparedPixels;

  const inputDelays = normalizedDelays(analysis.delays, analysis.frames);
  const outputDelays = normalizedDelays(outputMetadata.delay ?? [], outputFrames);
  const inputDuration = sum(inputDelays);
  const outputDuration = sum(outputDelays);
  const frameCountPreserved = outputFrames === analysis.frames;
  const loopPreserved =
    analysis.frames === 1 ||
    (outputFrames > 1 && (outputMetadata.loop ?? 0) === analysis.loop);
  const durationErrorMs = Math.abs(inputDuration - outputDuration);
  let maximumFrameDelayErrorMs = 0;
  const delaySlots = Math.max(inputDelays.length, outputDelays.length);
  for (let index = 0; index < delaySlots; index += 1) {
    maximumFrameDelayErrorMs = Math.max(
      maximumFrameDelayErrorMs,
      Math.abs((inputDelays[index] ?? 0) - (outputDelays[index] ?? 0)),
    );
  }

  const delaysPreserved =
    inputDelays.length === outputDelays.length &&
    inputDelays.every((delay, index) => delay === outputDelays[index]);
  const pixelExact =
    totals.maximumChannelError === 0 &&
    frameCountPreserved &&
    delaysPreserved &&
    durationErrorMs === 0 &&
    loopPreserved;

  let classification: QualityMetrics["classification"];
  if (pixelExact) classification = "pixel_exact";
  else if (
    (psnrDb === null || psnrDb >= 35) &&
    frameCountPreserved &&
    durationErrorMs <= 20
  ) {
    classification = "high_fidelity";
  } else if (
    (psnrDb === null || psnrDb >= 30) &&
    frameCountPreserved &&
    durationErrorMs <= 50
  ) {
    classification = "acceptable";
  } else {
    classification = "limited";
  }

  return {
    classification,
    psnrDb,
    meanAbsoluteError,
    rootMeanSquareError,
    maximumChannelError: totals.maximumChannelError,
    changedPixelRatio,
    frameCountPreserved,
    loopPreserved,
    durationErrorMs,
    maximumFrameDelayErrorMs,
  };
}
