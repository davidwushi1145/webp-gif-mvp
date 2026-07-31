import sharp from "sharp";

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

sharp.concurrency(readPositiveInteger("SHARP_CONCURRENCY", 1));
sharp.cache({
  memory: readPositiveInteger("SHARP_CACHE_MEMORY_MB", 32),
  files: 0,
  items: 10,
});

export default sharp;
