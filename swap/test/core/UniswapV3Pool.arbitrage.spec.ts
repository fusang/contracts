// @ts-nocheck - Hardhat contracts use dynamic methods not typed in BaseContract
import { Decimal } from "decimal.js";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Contract, Signer } from "ethers";
import { expect } from "./shared/expect";

import { poolFixture } from "./shared/fixtures";
import { formatPrice, formatTokenAmount } from "./shared/format";

import {
  createPoolFunctions,
  encodePriceSqrt,
  expandTo18Decimals,
  FeeAmount,
  getMaxLiquidityPerTick,
  getMaxTick,
  getMinTick,
  MAX_SQRT_RATIO,
  MaxUint128,
  MIN_SQRT_RATIO,
  MintFunction,
  SwapFunction,
  TICK_SPACINGS,
} from "./shared/utilities";

const MaxUint256 = ethers.MaxUint256;

Decimal.config({ toExpNeg: -500, toExpPos: 500 });

function applySqrtRatioBipsHundredthsDelta(sqrtRatio: bigint, bipsHundredths: number): bigint {
  return BigInt(
    new Decimal(
      (sqrtRatio * sqrtRatio * BigInt(1e6 + bipsHundredths) / BigInt(1e6)).toString()
    )
      .sqrt()
      .floor()
      .toString()
  );
}

describe("UniswapV3Pool arbitrage tests", () => {
  let wallet: Signer, arbitrageur: Signer;

  async function arbPoolFixture() {
    return poolFixture();
  }

  for (const feeProtocol of [0, 6]) {
    describe(`protocol fee = ${feeProtocol};`, () => {
      const startingPrice = encodePriceSqrt(1n, 1n);
      const startingTick = 0;
      const feeAmount = FeeAmount.MEDIUM;
      const tickSpacing = TICK_SPACINGS[feeAmount];
      const minTick = getMinTick(tickSpacing);
      const maxTick = getMaxTick(tickSpacing);

      for (const passiveLiquidity of [
        expandTo18Decimals(1) / 100n,
        expandTo18Decimals(1),
        expandTo18Decimals(10),
        expandTo18Decimals(100),
      ]) {
        describe(`passive liquidity of ${formatTokenAmount(passiveLiquidity)}`, () => {
          const arbTestFixture = async () => {
            [wallet, arbitrageur] = await ethers.getSigners();
            const fix = await poolFixture();

            const pool = await fix.createPool(feeAmount, tickSpacing);

            await fix.token0.transfer(await arbitrageur.getAddress(), 2n ** 254n);
            await fix.token1.transfer(await arbitrageur.getAddress(), 2n ** 254n);

            const { swapExact0For1, swapToHigherPrice, swapToLowerPrice, swapExact1For0, mint } =
              createPoolFunctions({
                swapTarget: fix.swapTargetCallee,
                token0: fix.token0,
                token1: fix.token1,
                pool,
              });

            const testerFactory = await ethers.getContractFactory("UniswapV3PoolSwapTest");
            const tester = await testerFactory.deploy();

            const tickMathFactory = await ethers.getContractFactory("TickMathTest");
            const tickMath = await tickMathFactory.deploy();

            // Add tester to allowList so it can interact with pools
            await fix.allowList.setAllowed(await tester.getAddress(), true);

            await fix.token0.approve(await tester.getAddress(), MaxUint256);
            await fix.token1.approve(await tester.getAddress(), MaxUint256);

            await pool.initialize(startingPrice);
            if (feeProtocol != 0) await pool.setFeeProtocol(feeProtocol, feeProtocol);
            await mint(await wallet.getAddress(), minTick, maxTick, passiveLiquidity);

            expect((await pool.slot0()).tick).to.eq(startingTick);
            expect((await pool.slot0()).sqrtPriceX96).to.eq(startingPrice);

            return { pool, swapExact0For1, mint, swapToHigherPrice, swapToLowerPrice, swapExact1For0, tester, tickMath };
          };

          let swapExact0For1: SwapFunction;
          let swapToHigherPrice: SwapFunction;
          let swapToLowerPrice: SwapFunction;
          let swapExact1For0: SwapFunction;
          let pool: Contract;
          let mint: MintFunction;
          let tester: Contract;
          let tickMath: Contract;

          beforeEach("load the fixture", async () => {
            ({ swapExact0For1, pool, mint, swapToHigherPrice, swapToLowerPrice, swapExact1For0, tester, tickMath } =
              await loadFixture(arbTestFixture));
          });

          async function simulateSwap(
            zeroForOne: boolean,
            amountSpecified: bigint,
            sqrtPriceLimitX96?: bigint
          ): Promise<{
            executionPrice: bigint;
            nextSqrtRatio: bigint;
            amount0Delta: bigint;
            amount1Delta: bigint;
          }> {
            const result = await tester.getSwapResult.staticCall(
              await pool.getAddress(),
              zeroForOne,
              amountSpecified,
              sqrtPriceLimitX96 ?? (zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n)
            );
            const amount0Delta = result.amount0Delta;
            const amount1Delta = result.amount1Delta;
            const nextSqrtRatio = result.nextSqrtRatio;

            const executionPrice = zeroForOne
              ? encodePriceSqrt(amount1Delta, -amount0Delta)
              : encodePriceSqrt(-amount1Delta, amount0Delta);

            return { executionPrice, nextSqrtRatio, amount0Delta, amount1Delta };
          }

          for (const { zeroForOne, assumedTruePriceAfterSwap, inputAmount, description } of [
            {
              description: "exact input of 10e18 token0 with starting price of 1.0 and true price of 0.98",
              zeroForOne: true,
              inputAmount: expandTo18Decimals(10),
              assumedTruePriceAfterSwap: encodePriceSqrt(98n, 100n),
            },
            {
              description: "exact input of 10e18 token0 with starting price of 1.0 and true price of 1.01",
              zeroForOne: true,
              inputAmount: expandTo18Decimals(10),
              assumedTruePriceAfterSwap: encodePriceSqrt(101n, 100n),
            },
          ]) {
            describe(description, () => {
              function valueToken1(arbBalance0: bigint, arbBalance1: bigint): bigint {
                return (
                  (assumedTruePriceAfterSwap * assumedTruePriceAfterSwap * arbBalance0) / (2n ** 192n) +
                  arbBalance1
                );
              }

              it("not sandwiched", async () => {
                const { executionPrice, amount1Delta, amount0Delta } = await simulateSwap(zeroForOne, inputAmount);
                zeroForOne
                  ? await swapExact0For1(inputAmount, await wallet.getAddress())
                  : await swapExact1For0(inputAmount, await wallet.getAddress());

                expect({
                  executionPrice: formatPrice(executionPrice),
                  amount0Delta: formatTokenAmount(amount0Delta),
                  amount1Delta: formatTokenAmount(amount1Delta),
                  priceAfter: formatPrice((await pool.slot0()).sqrtPriceX96),
                }).to.matchSnapshot();
              });

              it("sandwiched with swap to execution price then mint max liquidity/target/burn max liquidity", async () => {
                const { executionPrice } = await simulateSwap(zeroForOne, inputAmount);

                const firstTickAboveMarginalPrice = zeroForOne
                  ? Math.ceil(
                      Number(await tickMath.getTickAtSqrtRatio(
                        applySqrtRatioBipsHundredthsDelta(executionPrice, feeAmount)
                      )) / tickSpacing
                    ) * tickSpacing
                  : Math.floor(
                      Number(await tickMath.getTickAtSqrtRatio(
                        applySqrtRatioBipsHundredthsDelta(executionPrice, -feeAmount)
                      )) / tickSpacing
                    ) * tickSpacing;
                const tickAfterFirstTickAboveMarginPrice = zeroForOne
                  ? firstTickAboveMarginalPrice - tickSpacing
                  : firstTickAboveMarginalPrice + tickSpacing;

                const priceSwapStart = await tickMath.getSqrtRatioAtTick(firstTickAboveMarginalPrice);

                let arbBalance0 = 0n;
                let arbBalance1 = 0n;

                // first frontrun to the first tick before the execution price
                const {
                  amount0Delta: frontrunDelta0,
                  amount1Delta: frontrunDelta1,
                  executionPrice: frontrunExecutionPrice,
                } = await simulateSwap(zeroForOne, MaxUint256 / 2n, priceSwapStart);
                arbBalance0 = arbBalance0 - frontrunDelta0;
                arbBalance1 = arbBalance1 - frontrunDelta1;
                zeroForOne
                  ? await swapToLowerPrice(priceSwapStart, await arbitrageur.getAddress())
                  : await swapToHigherPrice(priceSwapStart, await arbitrageur.getAddress());

                const profitToken1AfterFrontRun = valueToken1(arbBalance0, arbBalance1);

                const tickLower = zeroForOne ? tickAfterFirstTickAboveMarginPrice : firstTickAboveMarginalPrice;
                const tickUpper = zeroForOne ? firstTickAboveMarginalPrice : tickAfterFirstTickAboveMarginPrice;

                // deposit max liquidity at the tick
                const mintTx = await mint(
                  await wallet.getAddress(),
                  tickLower,
                  tickUpper,
                  getMaxLiquidityPerTick(tickSpacing)
                );
                const mintReceipt = await mintTx.wait();
                // sub the mint costs
                const mintEvent = mintReceipt.logs.find(
                  (log: any) => log.fragment?.name === "Mint"
                );
                const amount0Mint = mintEvent?.args?.amount0 ?? 0n;
                const amount1Mint = mintEvent?.args?.amount1 ?? 0n;
                arbBalance0 = arbBalance0 - amount0Mint;
                arbBalance1 = arbBalance1 - amount1Mint;

                // execute the user's swap
                const { executionPrice: executionPriceAfterFrontrun } = await simulateSwap(zeroForOne, inputAmount);
                zeroForOne
                  ? await swapExact0For1(inputAmount, await wallet.getAddress())
                  : await swapExact1For0(inputAmount, await wallet.getAddress());

                // burn the arb's liquidity
                const burnResult = await pool.burn.staticCall(
                  tickLower,
                  tickUpper,
                  getMaxLiquidityPerTick(tickSpacing)
                );
                const amount0Burn = burnResult.amount0;
                const amount1Burn = burnResult.amount1;
                await pool.burn(tickLower, tickUpper, getMaxLiquidityPerTick(tickSpacing));
                arbBalance0 = arbBalance0 + amount0Burn;
                arbBalance1 = arbBalance1 + amount1Burn;

                // add the fees as well
                const collectResult = await pool.collect.staticCall(
                  await arbitrageur.getAddress(),
                  tickLower,
                  tickUpper,
                  MaxUint128,
                  MaxUint128
                );
                const amount0CollectAndBurn = collectResult.amount0;
                const amount1CollectAndBurn = collectResult.amount1;
                const amount0Collect = amount0CollectAndBurn - amount0Burn;
                const amount1Collect = amount1CollectAndBurn - amount1Burn;
                arbBalance0 = arbBalance0 + amount0Collect;
                arbBalance1 = arbBalance1 + amount1Collect;

                const profitToken1AfterSandwich = valueToken1(arbBalance0, arbBalance1);

                // backrun the swap to true price, i.e. swap to the marginal price = true price
                const priceToSwapTo = zeroForOne
                  ? applySqrtRatioBipsHundredthsDelta(assumedTruePriceAfterSwap, -feeAmount)
                  : applySqrtRatioBipsHundredthsDelta(assumedTruePriceAfterSwap, feeAmount);
                const {
                  amount0Delta: backrunDelta0,
                  amount1Delta: backrunDelta1,
                  executionPrice: backrunExecutionPrice,
                } = await simulateSwap(!zeroForOne, MaxUint256 / 2n, priceToSwapTo);
                await swapToHigherPrice(priceToSwapTo, await wallet.getAddress());
                arbBalance0 = arbBalance0 - backrunDelta0;
                arbBalance1 = arbBalance1 - backrunDelta1;

                expect({
                  sandwichedPrice: formatPrice(executionPriceAfterFrontrun),
                  arbBalanceDelta0: formatTokenAmount(arbBalance0),
                  arbBalanceDelta1: formatTokenAmount(arbBalance1),
                  profit: {
                    final: formatTokenAmount(valueToken1(arbBalance0, arbBalance1)),
                    afterFrontrun: formatTokenAmount(profitToken1AfterFrontRun),
                    afterSandwich: formatTokenAmount(profitToken1AfterSandwich),
                  },
                  backrun: {
                    executionPrice: formatPrice(backrunExecutionPrice),
                    delta0: formatTokenAmount(backrunDelta0),
                    delta1: formatTokenAmount(backrunDelta1),
                  },
                  frontrun: {
                    executionPrice: formatPrice(frontrunExecutionPrice),
                    delta0: formatTokenAmount(frontrunDelta0),
                    delta1: formatTokenAmount(frontrunDelta1),
                  },
                  collect: {
                    amount0: formatTokenAmount(amount0Collect),
                    amount1: formatTokenAmount(amount1Collect),
                  },
                  burn: {
                    amount0: formatTokenAmount(amount0Burn),
                    amount1: formatTokenAmount(amount1Burn),
                  },
                  mint: {
                    amount0: formatTokenAmount(amount0Mint),
                    amount1: formatTokenAmount(amount1Mint),
                  },
                  finalPrice: formatPrice((await pool.slot0()).sqrtPriceX96),
                }).to.matchSnapshot();
              });

              it("backrun to true price after swap only", async () => {
                let arbBalance0 = 0n;
                let arbBalance1 = 0n;

                zeroForOne
                  ? await swapExact0For1(inputAmount, await wallet.getAddress())
                  : await swapExact1For0(inputAmount, await wallet.getAddress());

                // swap to the marginal price = true price
                const priceToSwapTo = zeroForOne
                  ? applySqrtRatioBipsHundredthsDelta(assumedTruePriceAfterSwap, -feeAmount)
                  : applySqrtRatioBipsHundredthsDelta(assumedTruePriceAfterSwap, feeAmount);
                const {
                  amount0Delta: backrunDelta0,
                  amount1Delta: backrunDelta1,
                  executionPrice: backrunExecutionPrice,
                } = await simulateSwap(!zeroForOne, MaxUint256 / 2n, priceToSwapTo);
                zeroForOne
                  ? await swapToHigherPrice(priceToSwapTo, await wallet.getAddress())
                  : await swapToLowerPrice(priceToSwapTo, await wallet.getAddress());
                arbBalance0 = arbBalance0 - backrunDelta0;
                arbBalance1 = arbBalance1 - backrunDelta1;

                expect({
                  arbBalanceDelta0: formatTokenAmount(arbBalance0),
                  arbBalanceDelta1: formatTokenAmount(arbBalance1),
                  profit: {
                    final: formatTokenAmount(valueToken1(arbBalance0, arbBalance1)),
                  },
                  backrun: {
                    executionPrice: formatPrice(backrunExecutionPrice),
                    delta0: formatTokenAmount(backrunDelta0),
                    delta1: formatTokenAmount(backrunDelta1),
                  },
                  finalPrice: formatPrice((await pool.slot0()).sqrtPriceX96),
                }).to.matchSnapshot();
              });
            });
          }
        });
      }
    });
  }
});
