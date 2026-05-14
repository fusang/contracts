// @ts-nocheck - Hardhat contracts use dynamic methods not typed in BaseContract
import { ethers } from "hardhat";
import { Contract, Signer, ContractTransactionResponse } from "ethers";
import BigNumber from "bignumber.js";

export const MaxUint128 = 2n ** 128n - 1n;

export const MIN_SQRT_RATIO = 4295128739n;
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

export enum FeeAmount {
  LOW = 500,
  MEDIUM = 3000,
  HIGH = 10000,
}

export const TICK_SPACINGS: { [amount in FeeAmount]: number } = {
  [FeeAmount.LOW]: 10,
  [FeeAmount.MEDIUM]: 60,
  [FeeAmount.HIGH]: 200,
};

export function getMinTick(tickSpacing: number): number {
  return Math.ceil(-887272 / tickSpacing) * tickSpacing;
}

export function getMaxTick(tickSpacing: number): number {
  return Math.floor(887272 / tickSpacing) * tickSpacing;
}

export function getMaxLiquidityPerTick(tickSpacing: number): bigint {
  return (
    (2n ** 128n - 1n) /
    BigInt((getMaxTick(tickSpacing) - getMinTick(tickSpacing)) / tickSpacing + 1)
  );
}

export function expandTo18Decimals(n: number): bigint {
  return BigInt(n) * 10n ** 18n;
}

BigNumber.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

// returns the sqrt price as a 64x96
export function encodePriceSqrt(reserve1: bigint | number, reserve0: bigint | number): bigint {
  return BigInt(
    new BigNumber(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new BigNumber(2).pow(96))
      .integerValue(3)
      .toString()
  );
}

export function getCreate2Address(
  factoryAddress: string,
  [tokenA, tokenB]: [string, string],
  fee: number,
  bytecode: string
): string {
  const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  const constructorArgumentsEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint24"],
    [token0, token1, fee]
  );
  const create2Inputs = [
    "0xff",
    factoryAddress,
    ethers.keccak256(constructorArgumentsEncoded),
    ethers.keccak256(bytecode),
  ];
  const sanitizedInputs = `0x${create2Inputs.map((i) => i.slice(2)).join("")}`;
  return ethers.getAddress(`0x${ethers.keccak256(sanitizedInputs).slice(-40)}`);
}

export function getPositionKey(address: string, lowerTick: number, upperTick: number): string {
  return ethers.keccak256(ethers.solidityPacked(["address", "int24", "int24"], [address, lowerTick, upperTick]));
}

export type SwapFunction = (
  amount: bigint | number,
  to: Signer | string,
  sqrtPriceLimitX96?: bigint
) => Promise<ContractTransactionResponse>;

export type SwapToPriceFunction = (
  sqrtPriceX96: bigint,
  to: Signer | string
) => Promise<ContractTransactionResponse>;

export type FlashFunction = (
  amount0: bigint | number,
  amount1: bigint | number,
  to: Signer | string,
  pay0?: bigint | number,
  pay1?: bigint | number
) => Promise<ContractTransactionResponse>;

export type MintFunction = (
  recipient: string,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint | number
) => Promise<ContractTransactionResponse>;

export interface PoolFunctions {
  swapToLowerPrice: SwapToPriceFunction;
  swapToHigherPrice: SwapToPriceFunction;
  swapExact0For1: SwapFunction;
  swap0ForExact1: SwapFunction;
  swapExact1For0: SwapFunction;
  swap1ForExact0: SwapFunction;
  flash: FlashFunction;
  mint: MintFunction;
}

export function createPoolFunctions({
  swapTarget,
  token0,
  token1,
  pool,
}: {
  swapTarget: Contract;
  token0: Contract;
  token1: Contract;
  pool: Contract;
}): PoolFunctions {
  async function swapToSqrtPrice(
    inputToken: Contract,
    targetPrice: bigint,
    to: Signer | string
  ): Promise<ContractTransactionResponse> {
    const method =
      (await inputToken.getAddress()) === (await token0.getAddress())
        ? swapTarget.swapToLowerSqrtPrice
        : swapTarget.swapToHigherSqrtPrice;

    await inputToken.approve(await swapTarget.getAddress(), ethers.MaxUint256);

    const toAddress = typeof to === "string" ? to : await to.getAddress();

    return method(await pool.getAddress(), targetPrice, toAddress);
  }

  async function swap(
    inputToken: Contract,
    [amountIn, amountOut]: [bigint | number, bigint | number],
    to: Signer | string,
    sqrtPriceLimitX96?: bigint
  ): Promise<ContractTransactionResponse> {
    const exactInput = amountOut === 0 || amountOut === 0n;

    const isToken0 = (await inputToken.getAddress()) === (await token0.getAddress());
    const method = isToken0
      ? exactInput
        ? swapTarget.swapExact0For1
        : swapTarget.swap0ForExact1
      : exactInput
      ? swapTarget.swapExact1For0
      : swapTarget.swap1ForExact0;

    if (typeof sqrtPriceLimitX96 === "undefined") {
      sqrtPriceLimitX96 = isToken0 ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n;
    }
    await inputToken.approve(await swapTarget.getAddress(), ethers.MaxUint256);

    const toAddress = typeof to === "string" ? to : await to.getAddress();

    return method(
      await pool.getAddress(),
      exactInput ? amountIn : amountOut,
      toAddress,
      sqrtPriceLimitX96
    );
  }

  const swapToLowerPrice: SwapToPriceFunction = (sqrtPriceX96, to) => {
    return swapToSqrtPrice(token0, sqrtPriceX96, to);
  };

  const swapToHigherPrice: SwapToPriceFunction = (sqrtPriceX96, to) => {
    return swapToSqrtPrice(token1, sqrtPriceX96, to);
  };

  const swapExact0For1: SwapFunction = (amount, to, sqrtPriceLimitX96) => {
    return swap(token0, [BigInt(amount), 0n], to, sqrtPriceLimitX96);
  };

  const swap0ForExact1: SwapFunction = (amount, to, sqrtPriceLimitX96) => {
    return swap(token0, [0n, BigInt(amount)], to, sqrtPriceLimitX96);
  };

  const swapExact1For0: SwapFunction = (amount, to, sqrtPriceLimitX96) => {
    return swap(token1, [BigInt(amount), 0n], to, sqrtPriceLimitX96);
  };

  const swap1ForExact0: SwapFunction = (amount, to, sqrtPriceLimitX96) => {
    return swap(token1, [0n, BigInt(amount)], to, sqrtPriceLimitX96);
  };

  const mint: MintFunction = async (recipient, tickLower, tickUpper, liquidity) => {
    await token0.approve(await swapTarget.getAddress(), ethers.MaxUint256);
    await token1.approve(await swapTarget.getAddress(), ethers.MaxUint256);
    return swapTarget.mint(await pool.getAddress(), recipient, tickLower, tickUpper, liquidity);
  };

  const flash: FlashFunction = async (amount0, amount1, to, pay0?, pay1?) => {
    const fee = await pool.fee();
    if (typeof pay0 === "undefined") {
      pay0 = (BigInt(amount0) * BigInt(fee) + 1000000n - 1n) / 1000000n + BigInt(amount0);
    }
    if (typeof pay1 === "undefined") {
      pay1 = (BigInt(amount1) * BigInt(fee) + 1000000n - 1n) / 1000000n + BigInt(amount1);
    }
    const toAddress = typeof to === "string" ? to : await to.getAddress();
    return swapTarget.flash(await pool.getAddress(), toAddress, amount0, amount1, pay0, pay1);
  };

  return {
    swapToLowerPrice,
    swapToHigherPrice,
    swapExact0For1,
    swap0ForExact1,
    swapExact1For0,
    swap1ForExact0,
    mint,
    flash,
  };
}

export interface MultiPoolFunctions {
  swapForExact0Multi: SwapFunction;
  swapForExact1Multi: SwapFunction;
}

export function createMultiPoolFunctions({
  inputToken,
  swapTarget,
  poolInput,
  poolOutput,
}: {
  inputToken: Contract;
  swapTarget: Contract;
  poolInput: Contract;
  poolOutput: Contract;
}): MultiPoolFunctions {
  async function swapForExact0Multi(
    amountOut: bigint | number,
    to: Signer | string
  ): Promise<ContractTransactionResponse> {
    const method = swapTarget.swapForExact0Multi;
    await inputToken.approve(await swapTarget.getAddress(), ethers.MaxUint256);
    const toAddress = typeof to === "string" ? to : await to.getAddress();
    return method(toAddress, await poolInput.getAddress(), await poolOutput.getAddress(), amountOut);
  }

  async function swapForExact1Multi(
    amountOut: bigint | number,
    to: Signer | string
  ): Promise<ContractTransactionResponse> {
    const method = swapTarget.swapForExact1Multi;
    await inputToken.approve(await swapTarget.getAddress(), ethers.MaxUint256);
    const toAddress = typeof to === "string" ? to : await to.getAddress();
    return method(toAddress, await poolInput.getAddress(), await poolOutput.getAddress(), amountOut);
  }

  return {
    swapForExact0Multi,
    swapForExact1Multi,
  };
}
