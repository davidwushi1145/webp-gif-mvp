export function quantizeGifDelays(delays: readonly number[]): number[] {
  let carry = 0;

  return delays.map((delay) => {
    if (delay === 0) return 0;

    const adjusted = delay + carry;
    const quantized = Math.max(10, Math.round(adjusted / 10) * 10);
    carry = adjusted - quantized;
    return quantized;
  });
}
