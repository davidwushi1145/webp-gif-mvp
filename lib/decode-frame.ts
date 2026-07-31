import { IMAGE_LIMITS } from "./config";
import { AppError } from "./errors";
import sharp from "./sharp-runtime";

export async function decodeRgbaFrame(
  inputPath: string,
  frame: number,
  expectedWidth: number,
  expectedHeight: number,
): Promise<Buffer> {
  const { data, info } = await sharp(inputPath, {
    page: frame,
    pages: 1,
    failOn: "warning",
    limitInputPixels: IMAGE_LIMITS.maxTotalPixels,
  })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (
    info.width !== expectedWidth ||
    info.height !== expectedHeight ||
    info.channels !== 4
  ) {
    throw new AppError(
      422,
      "FRAME_DIMENSION_MISMATCH",
      "动画帧尺寸不一致，无法安全转换。",
    );
  }

  return data;
}
