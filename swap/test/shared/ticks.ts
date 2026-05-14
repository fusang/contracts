const MIN_TICK = -887272;
const MAX_TICK = 887272;

export const getMinTick = (tickSpacing: number): number =>
  Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;

export const getMaxTick = (tickSpacing: number): number =>
  Math.floor(MAX_TICK / tickSpacing) * tickSpacing;

export const getMaxLiquidityPerTick = (tickSpacing: number): bigint => {
  const maxTick = getMaxTick(tickSpacing);
  const minTick = getMinTick(tickSpacing);
  const numTicks = (maxTick - minTick) / tickSpacing + 1;
  return (2n ** 128n - 1n) / BigInt(numTicks);
};
