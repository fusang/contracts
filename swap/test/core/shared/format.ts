import { Decimal } from "decimal.js";

export function formatPrice(sqrtRatioX96: bigint): string {
  return new Decimal(sqrtRatioX96.toString())
    .div(new Decimal(2).pow(96))
    .pow(2)
    .toPrecision(5);
}

export function formatTokenAmount(num: bigint): string {
  return new Decimal(num.toString()).div(new Decimal(10).pow(18)).toPrecision(5);
}
