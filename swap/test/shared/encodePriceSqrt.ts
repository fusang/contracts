import BigNumber from "bignumber.js";

// Configure bignumber.js settings
BigNumber.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

/**
 * Returns the sqrt price as a 64x96 fixed-point number
 * @param reserve1 - The reserve of token1
 * @param reserve0 - The reserve of token0
 * @returns The sqrt price as a string
 */
export function encodePriceSqrt(
  reserve1: number | string | BigNumber,
  reserve0: number | string | BigNumber
): string {
  return new BigNumber(reserve1.toString())
    .div(reserve0.toString())
    .sqrt()
    .multipliedBy(new BigNumber(2).pow(96))
    .integerValue(BigNumber.ROUND_FLOOR)
    .toString();
}
