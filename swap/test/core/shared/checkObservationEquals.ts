import { expect } from "./expect";

export default function checkObservationEquals(
  {
    blockTimestamp,
    tickCumulative,
    secondsPerLiquidityCumulativeX128,
    initialized,
  }: {
    blockTimestamp: bigint;
    tickCumulative: bigint;
    secondsPerLiquidityCumulativeX128: bigint;
    initialized: boolean;
  },
  expected: {
    blockTimestamp: number;
    tickCumulative: number;
    secondsPerLiquidityCumulativeX128: bigint | string | number;
    initialized: boolean;
  }
): void {
  expect(
    { blockTimestamp, tickCumulative, secondsPerLiquidityCumulativeX128, initialized },
    "observation mismatch"
  ).to.deep.eq({
    blockTimestamp: BigInt(expected.blockTimestamp),
    tickCumulative: BigInt(expected.tickCumulative),
    secondsPerLiquidityCumulativeX128: BigInt(expected.secondsPerLiquidityCumulativeX128),
    initialized: expected.initialized,
  });
}
