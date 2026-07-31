import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { analyzeWebp } from "@/lib/analyze-webp";
import { withConversionLock } from "@/lib/conversion-lock";
import { convertWebpToGif, selectGifDither } from "@/lib/convert-webp";
import { AppError } from "@/lib/errors";
import {
  isLocale,
  localeFromAcceptLanguage,
  locales,
} from "@/lib/i18n";
import {
  JOB_FILES,
  cleanupExpiredJobs,
  getJobFile,
  writeJsonAtomic,
} from "@/lib/job-storage";
import {
  paletteEntriesUpTo257,
  parseHexColour,
  transformRgbaInPlace,
} from "@/lib/pixels";
import { compareRgbaBuffers } from "@/lib/quality";
import sharp from "@/lib/sharp-runtime";
import { quantizeGifDelays } from "@/lib/timing";
import { streamMultipartUpload } from "@/lib/upload";
import type { ConvertOptions, JobDocument } from "@/lib/types";
import en from "@/messages/en";
import zh from "@/messages/zh";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "webp-gif-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  delete process.env.JOB_ROOT;
});

describe("internationalization", () => {
  test("keeps English and Chinese dictionaries structurally identical", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  test("resolves supported browser languages with an English fallback", () => {
    expect(locales).toEqual(["en", "zh"]);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(localeFromAcceptLanguage("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh");
    expect(localeFromAcceptLanguage("fr-FR,en-US;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage(null)).toBe("en");
  });
});

describe("timing and pixel transforms", () => {
  test("auto mode protects transparent silhouettes from dithering", () => {
    expect(selectGifDither("auto", "binary", false)).toBe(0);
    expect(selectGifDither("auto", "partial", false)).toBe(0);
    expect(selectGifDither("auto", "none", true)).toBe(0);
    expect(selectGifDither("auto", "none", false)).toBe(1);
    expect(selectGifDither("photo", "binary", true)).toBe(1);
    expect(selectGifDither("line-art", "none", false)).toBe(0);
  });

  test("quantizes animation delays with carried error", () => {
    const result = quantizeGifDelays([17, 17, 16, 17, 16, 17]);
    expect(result).toEqual([20, 10, 20, 20, 10, 20]);
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(quantizeGifDelays([17, 0, 17])).toEqual([20, 0, 10]);
  });

  test("thresholds alpha and flattens against the selected colour", () => {
    const preserve = Buffer.from([10, 20, 30, 127, 40, 50, 60, 128]);
    transformRgbaInPlace(preserve, "preserve", parseHexColour("#FFFFFF"), 128);
    expect([...preserve]).toEqual([10, 20, 30, 0, 40, 50, 60, 255]);

    const flatten = Buffer.from([200, 100, 0, 128]);
    transformRgbaInPlace(flatten, "flatten", parseHexColour("#000000"), 128);
    expect([...flatten]).toEqual([100, 50, 0, 255]);
  });

  test("caps palette inspection at 257 entries", () => {
    const rgba = Buffer.alloc(257 * 4);
    for (let index = 0; index < 257; index += 1) {
      rgba[index * 4] = index & 255;
      rgba[index * 4 + 1] = index >> 8;
      rgba[index * 4 + 3] = 255;
    }
    expect(paletteEntriesUpTo257(rgba)).toBe(257);
  });

  test("ignores hidden RGB when both pixels are transparent", () => {
    const expected = Buffer.from([255, 0, 0, 0, 10, 20, 30, 255]);
    const actual = Buffer.from([0, 255, 255, 0, 10, 21, 30, 255]);
    const totals = compareRgbaBuffers(expected, actual);
    expect(totals.absoluteError).toBe(1);
    expect(totals.changedPixels).toBe(1);
    expect(totals.comparedChannels).toBe(5);
  });
});

describe("analysis and conversion", () => {
  test("streams one multipart file to disk without a false parts-limit error", async () => {
    const root = await temporaryRoot();
    const form = new FormData();
    form.append("file", new File([Buffer.from("webp-bytes")], "sample.webp"));
    const request = new Request("http://localhost/api/analyze", {
      method: "POST",
      body: form,
    });

    const upload = await streamMultipartUpload(request, root);
    expect(upload).toMatchObject({ originalName: "sample.webp", bytes: 10 });
    await expect(readFile(upload.path, "utf8")).resolves.toBe("webp-bytes");
  });

  test("analyzes partial alpha and rejects a PNG disguised as WebP", async () => {
    const root = await temporaryRoot();
    const webpPath = path.join(root, "partial.webp");
    const rgba = Buffer.from([
      255, 0, 0, 255,
      0, 255, 0, 128,
      0, 0, 255, 0,
      255, 255, 255, 255,
    ]);
    await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } }).webp().toFile(webpPath);
    const analysis = await analyzeWebp(webpPath, (await readFile(webpPath)).length);
    expect(analysis).toMatchObject({
      width: 2,
      height: 2,
      frames: 1,
      alphaMode: "partial",
      timingCompatible: true,
    });
    expect(analysis.warnings.map((warning) => warning.code)).toContain("PARTIAL_ALPHA");

    const pngPath = path.join(root, "fake.webp");
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
      .png()
      .toFile(pngPath);
    await expect(
      analyzeWebp(pngPath, (await readFile(pngPath)).length),
    ).rejects.toMatchObject({ code: "NOT_WEBP" } satisfies Partial<AppError>);
  });

  test("converts a static low-colour WebP and writes a verified report", async () => {
    const root = await temporaryRoot();
    process.env.JOB_ROOT = root;
    const jobId = randomUUID();
    await mkdir(path.join(root, jobId), { recursive: true });
    const inputPath = getJobFile(jobId, JOB_FILES.input);
    const pixels = Buffer.from([
      220, 40, 40, 255,
      220, 40, 40, 255,
      20, 40, 220, 255,
      20, 40, 220, 255,
    ]);
    await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } })
      .webp({ lossless: true })
      .toFile(inputPath);
    const analysis = await analyzeWebp(inputPath, (await readFile(inputPath)).length);
    const now = new Date();
    const document: JobDocument = {
      version: 1,
      jobId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      originalName: "two-colours.webp",
      analysis,
    };
    const options: ConvertOptions = {
      jobId,
      transparencyMode: "preserve",
      background: "#FFFFFF",
      alphaThreshold: 128,
      contentMode: "auto",
    };

    const response = await convertWebpToGif(document, options);
    expect(response.outputSize).toBeGreaterThan(0);
    expect(response.quality).toMatchObject({
      frameCountPreserved: true,
      loopPreserved: true,
      durationErrorMs: 0,
    });
    const outputMetadata = await sharp(getJobFile(jobId, JOB_FILES.output)).metadata();
    expect(outputMetadata).toMatchObject({ format: "gif", width: 2, height: 2 });
    const report = JSON.parse(
      await readFile(getJobFile(jobId, JOB_FILES.report), "utf8"),
    );
    expect(report.jobId).toBe(jobId);
  });

  test("preserves animated frame count, quantized timing, and loop", async () => {
    const root = await temporaryRoot();
    process.env.JOB_ROOT = root;
    const jobId = randomUUID();
    await mkdir(path.join(root, jobId), { recursive: true });
    const inputPath = getJobFile(jobId, JOB_FILES.input);
    const width = 2;
    const frameHeight = 2;
    const frames = 3;
    const stacked = Buffer.alloc(width * frameHeight * frames * 4);
    const colours = [
      [240, 40, 30],
      [30, 220, 70],
      [30, 80, 230],
    ];
    for (let frame = 0; frame < frames; frame += 1) {
      for (let pixel = 0; pixel < width * frameHeight; pixel += 1) {
        const offset = (frame * width * frameHeight + pixel) * 4;
        stacked[offset] = colours[frame][0];
        stacked[offset + 1] = colours[frame][1];
        stacked[offset + 2] = colours[frame][2];
        stacked[offset + 3] = 255;
      }
    }
    await sharp(stacked, {
      raw: {
        width,
        height: frameHeight * frames,
        channels: 4,
        pageHeight: frameHeight,
      },
    })
      .webp({ lossless: true, loop: 2, delay: [17, 17, 16] })
      .toFile(inputPath);

    const analysis = await analyzeWebp(inputPath, (await readFile(inputPath)).length);
    expect(analysis).toMatchObject({ frames: 3, delays: [17, 17, 16], loop: 2 });
    const now = new Date();
    const document: JobDocument = {
      version: 1,
      jobId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      originalName: "animated.webp",
      analysis,
    };
    const response = await convertWebpToGif(document, {
      jobId,
      transparencyMode: "preserve",
      background: "#FFFFFF",
      alphaThreshold: 128,
      contentMode: "auto",
    });
    const metadata = await sharp(getJobFile(jobId, JOB_FILES.output), {
      animated: true,
    }).metadata();
    expect(metadata.pages).toBe(3);
    expect(metadata.delay).toEqual([20, 10, 20]);
    expect(metadata.loop).toBe(2);
    expect(response.adaptations).toContain("timing_quantized");
    expect(response.quality.durationErrorMs).toBe(0);
  });
});

describe("job lifecycle and concurrency", () => {
  test("runs conversions strictly one at a time", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = withConversionLock(randomUUID(), async () => {
      order.push("first:start");
      await firstCanFinish;
      order.push("first:end");
    });
    const second = withConversionLock(randomUUID(), async () => {
      order.push("second:start");
      order.push("second:end");
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  test("rejects duplicate jobs and caps the conversion queue", async () => {
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstId = randomUUID();
    const first = withConversionLock(firstId, async () => firstCanFinish);

    await expect(
      withConversionLock(firstId, async () => undefined),
    ).rejects.toMatchObject({ status: 409, code: "JOB_ALREADY_QUEUED" });

    const second = withConversionLock(randomUUID(), async () => undefined);
    const third = withConversionLock(randomUUID(), async () => undefined);
    await expect(
      withConversionLock(randomUUID(), async () => undefined),
    ).rejects.toMatchObject({ status: 429, code: "CONVERSION_QUEUE_FULL" });

    releaseFirst();
    await Promise.all([first, second, third]);
  });

  test("removes only expired UUID job directories", async () => {
    const root = await temporaryRoot();
    process.env.JOB_ROOT = root;
    const jobId = randomUUID();
    await mkdir(path.join(root, jobId), { recursive: true });
    const expired = new Date(Date.now() - 1_000);
    const document = {
      version: 1,
      jobId,
      createdAt: new Date(expired.getTime() - 60_000).toISOString(),
      expiresAt: expired.toISOString(),
      originalName: "old.webp",
      analysis: {},
    };
    await writeJsonAtomic(getJobFile(jobId, JOB_FILES.analysis), document);
    await writeFile(path.join(root, "do-not-delete"), "sentinel");

    expect(await cleanupExpiredJobs()).toBe(1);
    await expect(readFile(path.join(root, "do-not-delete"), "utf8")).resolves.toBe("sentinel");
  });
});
