import { randomUUID } from "node:crypto";
import { rename, rm, stat } from "node:fs/promises";
import { decodeRgbaFrame } from "./decode-frame";
import { AppError } from "./errors";
import {
  JOB_FILES,
  getJobFile,
  writeJsonAtomic,
} from "./job-storage";
import {
  paletteEntriesUpTo257,
  parseHexColour,
  transformRgbaInPlace,
} from "./pixels";
import { measureGifQuality } from "./quality";
import sharp from "./sharp-runtime";
import { quantizeGifDelays } from "./timing";
import type {
  AlphaMode,
  Adaptation,
  ContentMode,
  ConvertOptions,
  ConvertResponse,
  JobDocument,
  QualityReport,
} from "./types";

export function selectGifDither(
  contentMode: ContentMode,
  sourceAlphaMode: AlphaMode,
  targetPaletteCompatible: boolean,
): 0 | 1 {
  if (contentMode === "line-art") return 0;
  if (contentMode === "photo") return 1;

  // Transparent assets are commonly stickers, logos and UI graphics. Global
  // Floyd-Steinberg dithering makes their high-contrast silhouette visibly
  // noisy, so auto mode protects the edge even when colours exceed 256.
  if (sourceAlphaMode !== "none") return 0;

  return targetPaletteCompatible ? 0 : 1;
}

function animationDelays(document: JobDocument): number[] {
  const { frames, delays } = document.analysis;
  if (frames === 1) return [];
  if (delays.length === frames) return quantizeGifDelays(delays);
  return Array.from({ length: frames }, () => 100);
}

function collectAdaptations(
  document: JobDocument,
  options: ConvertOptions,
  outputDelays: readonly number[],
): Adaptation[] {
  const { analysis } = document;
  const adaptations: Adaptation[] = [];

  if (analysis.alphaMode === "partial") {
    adaptations.push(
      options.transparencyMode === "flatten"
        ? "partial_alpha_flattened"
        : "partial_alpha_thresholded",
    );
  } else if (
    analysis.alphaMode === "binary" &&
    options.transparencyMode === "flatten"
  ) {
    adaptations.push("binary_transparency_flattened");
  }
  if (
    analysis.frames > 1 &&
    (analysis.delays.length !== outputDelays.length ||
      analysis.delays.some((delay, index) => delay !== outputDelays[index]))
  ) {
    adaptations.push("timing_quantized");
  }
  if (analysis.hasIccProfile) adaptations.push("icc_normalized_to_srgb");

  return adaptations;
}

export async function convertWebpToGif(
  document: JobDocument,
  options: ConvertOptions,
): Promise<ConvertResponse> {
  const { analysis, jobId } = document;
  const inputPath = getJobFile(jobId, JOB_FILES.input);
  const outputPath = getJobFile(jobId, JOB_FILES.output);
  const reportPath = getJobFile(jobId, JOB_FILES.report);
  const temporaryOutput = `${outputPath}.${randomUUID()}.tmp`;
  const background = parseHexColour(options.background);
  const bytesPerFrame = analysis.width * analysis.height * 4;
  let stackedRgba: Buffer | undefined = Buffer.allocUnsafe(
    bytesPerFrame * analysis.frames,
  );
  let targetPaletteCompatible = true;

  try {
    for (let frame = 0; frame < analysis.frames; frame += 1) {
      const rgba = transformRgbaInPlace(
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
      targetPaletteCompatible &&= paletteEntriesUpTo257(rgba) <= 256;
      rgba.copy(stackedRgba, frame * bytesPerFrame);
    }

    const dither = selectGifDither(
      options.contentMode,
      analysis.alphaMode,
      targetPaletteCompatible,
    );
    const delays = animationDelays(document);

    await sharp(stackedRgba, {
      raw: {
        width: analysis.width,
        height: analysis.height * analysis.frames,
        channels: 4,
        pageHeight: analysis.height,
      },
    })
      .gif({
        colours: 256,
        effort: 10,
        reuse: false,
        dither,
        interFrameMaxError: 0,
        interPaletteMaxError: 0,
        keepDuplicateFrames: true,
        loop: analysis.loop,
        delay: analysis.frames > 1 ? delays : undefined,
      })
      .toFile(temporaryOutput);

    stackedRgba = undefined;
    const quality = await measureGifQuality(
      inputPath,
      temporaryOutput,
      analysis,
      options,
    );
    const outputSize = (await stat(/*turbopackIgnore: true*/ temporaryOutput)).size;
    const adaptations = collectAdaptations(document, options, delays);
    const response: ConvertResponse = {
      jobId,
      outputUrl: `/api/jobs/${jobId}/output`,
      reportUrl: `/api/jobs/${jobId}/report`,
      outputSize,
      quality,
      adaptations,
    };
    const report: QualityReport = {
      version: 1,
      jobId,
      generatedAt: new Date().toISOString(),
      source: {
        width: analysis.width,
        height: analysis.height,
        frames: analysis.frames,
        durationMs: analysis.durationMs,
        loop: analysis.loop,
        fileSize: analysis.fileSize,
      },
      options,
      outputSize,
      quality,
      adaptations,
    };

    await rename(temporaryOutput, outputPath);
    try {
      await writeJsonAtomic(reportPath, report);
    } catch (error) {
      await rm(outputPath, { force: true }).catch(() => undefined);
      throw error;
    }

    return response;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("GIF conversion failed", error);
    throw new AppError(500, "CONVERSION_FAILED", "GIF 转换失败。");
  } finally {
    stackedRgba = undefined;
    await rm(temporaryOutput, { force: true }).catch(() => undefined);
  }
}
