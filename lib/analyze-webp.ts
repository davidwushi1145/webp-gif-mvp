import { IMAGE_LIMITS } from "./config";
import { decodeRgbaFrame } from "./decode-frame";
import { AppError } from "./errors";
import sharp from "./sharp-runtime";
import type { AlphaMode, WebpAnalysis } from "./types";

interface ScanResult {
  hasTransparent: boolean;
  hasPartialAlpha: boolean;
  paletteEntries: number;
}

function scanFrame(rgba: Buffer): ScanResult {
  let hasTransparent = false;
  let hasPartialAlpha = false;
  const colours = new Set<number>();
  let paletteEntries = 0;

  for (let offset = 0; offset < rgba.length; offset += 4) {
    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];
    const a = rgba[offset + 3];

    if (a === 0) hasTransparent = true;
    else if (a < 255) hasPartialAlpha = true;

    if (paletteEntries <= 256) {
      const key = a === 0 ? 0 : (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
      colours.add(key);
      paletteEntries = colours.size > 256 ? 257 : colours.size;
    }
  }

  return { hasTransparent, hasPartialAlpha, paletteEntries };
}

function validateDimensions(
  width: number,
  height: number,
  frames: number,
): void {
  if (width > IMAGE_LIMITS.maxWidth) {
    throw new AppError(422, "WIDTH_LIMIT", "图片宽度超过限制。");
  }
  if (height > IMAGE_LIMITS.maxHeight) {
    throw new AppError(422, "HEIGHT_LIMIT", "图片高度超过限制。");
  }
  if (frames > IMAGE_LIMITS.maxFrames) {
    throw new AppError(422, "FRAME_LIMIT", "动画帧数超过限制。");
  }

  const totalPixels = width * height * frames;
  if (!Number.isSafeInteger(totalPixels) || totalPixels > IMAGE_LIMITS.maxTotalPixels) {
    throw new AppError(422, "PIXEL_LIMIT", "总解码像素数超过限制。");
  }
}

export async function analyzeWebp(
  inputPath: string,
  fileSize: number,
): Promise<WebpAnalysis> {
  if (fileSize <= 0) {
    throw new AppError(422, "EMPTY_FILE", "输入文件为空。");
  }
  if (fileSize > IMAGE_LIMITS.maxUploadBytes) {
    throw new AppError(413, "FILE_TOO_LARGE", "文件超过上传大小限制。");
  }

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(inputPath, {
      animated: true,
      failOn: "warning",
      limitInputPixels: IMAGE_LIMITS.maxTotalPixels,
    }).metadata();
  } catch {
    throw new AppError(422, "INVALID_IMAGE", "文件损坏、过大或不是有效的 WebP。");
  }

  if (metadata.format !== "webp") {
    throw new AppError(422, "NOT_WEBP", "文件内容不是 WebP。");
  }
  if (!metadata.width || !metadata.height) {
    throw new AppError(422, "MISSING_DIMENSIONS", "无法读取图片尺寸。");
  }

  const width = metadata.width;
  const frames = metadata.pages ?? 1;
  const frameHeight = metadata.pageHeight ?? metadata.height;
  if (!Number.isInteger(frames) || frames < 1 || !Number.isInteger(frameHeight)) {
    throw new AppError(422, "INVALID_ANIMATION", "动画页信息无效。");
  }
  validateDimensions(width, frameHeight, frames);

  const delays = frames > 1 ? [...(metadata.delay ?? [])] : [];
  const loop = metadata.loop ?? 0;
  if (
    frames > 1 &&
    (delays.length !== frames ||
      delays.some((delay) => !Number.isInteger(delay) || delay < 0))
  ) {
    throw new AppError(422, "INVALID_TIMING", "动画帧时长信息无效。");
  }
  const durationMs = delays.reduce((sum, delay) => sum + delay, 0);
  if (durationMs > IMAGE_LIMITS.maxDurationMs) {
    throw new AppError(422, "DURATION_LIMIT", "动画总时长超过限制。");
  }

  let hasTransparent = false;
  let hasPartialAlpha = false;
  let maxPaletteEntriesPerFrame = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    let rgba: Buffer;
    try {
      rgba = await decodeRgbaFrame(inputPath, frame, width, frameHeight);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(422, "DECODE_FAILED", "WebP 帧解码失败。");
    }

    const result = scanFrame(rgba);
    hasTransparent ||= result.hasTransparent;
    hasPartialAlpha ||= result.hasPartialAlpha;
    maxPaletteEntriesPerFrame = Math.max(
      maxPaletteEntriesPerFrame,
      result.paletteEntries,
    );
  }

  const alphaMode: AlphaMode = hasPartialAlpha
    ? "partial"
    : hasTransparent
      ? "binary"
      : "none";
  const timingCompatible =
    frames === 1 ||
    (delays.length === frames &&
      delays.every(
        (delay) => Number.isInteger(delay) && delay >= 0 && delay % 10 === 0,
      ));
  const paletteCompatible = maxPaletteEntriesPerFrame <= 256;
  const decodedPixelExactPossible =
    alphaMode !== "partial" && timingCompatible && paletteCompatible;
  const warnings: WebpAnalysis["warnings"] = [];

  if (alphaMode === "partial") {
    warnings.push({
      code: "PARTIAL_ALPHA",
      message: "输入包含半透明像素，GIF 只能保留完全透明或完全不透明。",
    });
  }
  if (!timingCompatible) {
    warnings.push({
      code: "TIMING_QUANTIZATION",
      message: "部分帧时长不是 10 ms 的整数倍，需要进行时间量化。",
    });
  }
  if (!paletteCompatible) {
    warnings.push({
      code: "PALETTE_QUANTIZATION",
      message: "部分帧超过 GIF 的 256 色能力，需要进行颜色量化。",
    });
  }
  if (metadata.hasProfile) {
    warnings.push({
      code: "ICC_NORMALIZATION",
      message: "输入包含 ICC 色彩配置，将标准化到 sRGB。",
    });
  }

  return {
    width,
    height: frameHeight,
    frames,
    delays,
    durationMs,
    loop,
    fileSize,
    alphaMode,
    timingCompatible,
    paletteCompatible,
    maxPaletteEntriesPerFrame,
    decodedPixelExactPossible,
    hasIccProfile: metadata.hasProfile ?? false,
    warnings,
  };
}
