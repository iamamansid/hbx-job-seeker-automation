export const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const randomBetween = (minMs: number, maxMs: number): number => {
  const safeMin = Math.max(0, Math.floor(minMs));
  const safeMax = Math.max(safeMin, Math.floor(maxMs));
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
};

export const humanDelay = async (minMs: number, maxMs: number): Promise<number> => {
  const delay = randomBetween(minMs, maxMs);
  await sleep(delay);
  return delay;
};
