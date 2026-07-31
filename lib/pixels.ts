import { AppError } from "./errors";
import type { TransparencyMode } from "./types";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHexColour(value: string): Rgb {
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new AppError(400, "INVALID_BACKGROUND", "背景颜色必须是 #RRGGBB 格式。");
  }

  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

export function transformRgbaInPlace(
  rgba: Buffer,
  mode: TransparencyMode,
  background: Rgb,
  alphaThreshold: number,
): Buffer {
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alphaByte = rgba[offset + 3];

    if (mode === "preserve") {
      rgba[offset + 3] = alphaByte >= alphaThreshold ? 255 : 0;
      continue;
    }

    const alpha = alphaByte / 255;
    rgba[offset] = Math.round(rgba[offset] * alpha + background.r * (1 - alpha));
    rgba[offset + 1] = Math.round(
      rgba[offset + 1] * alpha + background.g * (1 - alpha),
    );
    rgba[offset + 2] = Math.round(
      rgba[offset + 2] * alpha + background.b * (1 - alpha),
    );
    rgba[offset + 3] = 255;
  }

  return rgba;
}

export function paletteEntriesUpTo257(rgba: Buffer): number {
  const colours = new Set<number>();

  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3];
    const key =
      alpha === 0
        ? 0
        : (((rgba[offset] << 24) |
            (rgba[offset + 1] << 16) |
            (rgba[offset + 2] << 8) |
            alpha) >>>
          0);
    colours.add(key);
    if (colours.size > 256) return 257;
  }

  return colours.size;
}
