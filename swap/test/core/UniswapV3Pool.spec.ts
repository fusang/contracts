// @ts-nocheck - Hardhat contracts use dynamic methods not typed in BaseContract
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Contract, Signer } from "ethers";
import { poolFixture, TEST_POOL_START_TIME } from "./shared/fixtures";
import checkObservationEquals from "./shared/checkObservationEquals";
import {
  expandTo18Decimals,
  FeeAmount,
  getPositionKey,
  getMaxTick,
  getMinTick,
  encodePriceSqrt,
  TICK_SPACINGS,
  createPoolFunctions,
  SwapFunction,
  MintFunction,
  getMaxLiquidityPerTick,
  FlashFunction,
  MaxUint128,
  MAX_SQRT_RATIO,
  MIN_SQRT_RATIO,
  SwapToPriceFunction,
} from "./shared/utilities";

describe("UniswapV3Pool", () => {
  let wallet: Signer;
  let other: Signer;

  let token0: Contract;
  let token1: Contract;
  let token2: Contract;

  let factory: Contract;
  let pool: Contract;

  let swapTarget: Contract;

  let swapToLowerPrice: SwapToPriceFunction;
  let swapToHigherPrice: SwapToPriceFunction;
  let swapExact0For1: SwapFunction;
  let swap0ForExact1: SwapFunction;
  let swapExact1For0: SwapFunction;
  let swap1ForExact0: SwapFunction;

  let feeAmount: number;
  let tickSpacing: number;

  let minTick: number;
  let maxTick: number;

  let mint: MintFunction;
  let flash: FlashFunction;

  let createPool: (fee: number, tickSpacing: number) => Promise<Contract>;

  beforeEach("deploy fixture", async () => {
    [wallet, other] = await ethers.getSigners();
    const fixture = await loadFixture(poolFixture);
    token0 = fixture.token0;
    token1 = fixture.token1;
    token2 = fixture.token2;
    factory = fixture.factory;
    swapTarget = fixture.swapTargetCallee;

    const oldCreatePool = fixture.createPool;
    createPool = async (_feeAmount: number, _tickSpacing: number) => {
      const pool = await oldCreatePool(_feeAmount, _tickSpacing);
      ({
        swapToLowerPrice,
        swapToHigherPrice,
        swapExact0For1,
        swap0ForExact1,
        swapExact1For0,
        swap1ForExact0,
        mint,
        flash,
      } = createPoolFunctions({
        token0,
        token1,
        swapTarget,
        pool,
      }));
      minTick = getMinTick(_tickSpacing);
      maxTick = getMaxTick(_tickSpacing);
      feeAmount = _feeAmount;
      tickSpacing = _tickSpacing;
      return pool;
    };

    // default to the 30 bips pool
    pool = await createPool(FeeAmount.MEDIUM, TICK_SPACINGS[FeeAmount.MEDIUM]);
  });

  it("constructor initializes immutables", async () => {
    expect(await pool.factory()).to.eq(await factory.getAddress());
    expect(await pool.token0()).to.eq(await token0.getAddress());
    expect(await pool.token1()).to.eq(await token1.getAddress());
    expect(await pool.maxLiquidityPerTick()).to.eq(getMaxLiquidityPerTick(tickSpacing));
  });

  describe("#initialize", () => {
    it("fails if already initialized", async () => {
      await pool.initialize(encodePriceSqrt(1n, 1n));
      await expect(pool.initialize(encodePriceSqrt(1n, 1n))).to.be.reverted;
    });

    it("fails if starting price is too low", async () => {
      await expect(pool.initialize(1)).to.be.revertedWithCustomError(pool, "R");
      await expect(pool.initialize(MIN_SQRT_RATIO - 1n)).to.be.revertedWithCustomError(pool, "R");
    });

    it("fails if starting price is too high", async () => {
      await expect(pool.initialize(MAX_SQRT_RATIO)).to.be.revertedWithCustomError(pool, "R");
      await expect(pool.initialize(2n ** 160n - 1n)).to.be.revertedWithCustomError(pool, "R");
    });

    it("can be initialized at MIN_SQRT_RATIO", async () => {
      await pool.initialize(MIN_SQRT_RATIO);
      expect((await pool.slot0()).tick).to.eq(getMinTick(1));
    });

    it("can be initialized at MAX_SQRT_RATIO - 1", async () => {
      await pool.initialize(MAX_SQRT_RATIO - 1n);
      expect((await pool.slot0()).tick).to.eq(getMaxTick(1) - 1);
    });

    it("sets initial variables", async () => {
      const price = encodePriceSqrt(1n, 2n);
      await pool.initialize(price);

      const { sqrtPriceX96, observationIndex } = await pool.slot0();
      expect(sqrtPriceX96).to.eq(price);
      expect(observationIndex).to.eq(0);
      expect((await pool.slot0()).tick).to.eq(-6932);
    });

    it("initializes the first observations slot", async () => {
      await pool.initialize(encodePriceSqrt(1n, 1n));
      checkObservationEquals(await pool.observations(0), {
        secondsPerLiquidityCumulativeX128: 0,
        initialized: true,
        blockTimestamp: TEST_POOL_START_TIME,
        tickCumulative: 0,
      });
    });

    it("emits a Initialized event with the input tick", async () => {
      const sqrtPriceX96 = encodePriceSqrt(1n, 2n);
      await expect(pool.initialize(sqrtPriceX96)).to.emit(pool, "Initialize").withArgs(sqrtPriceX96, -6932);
    });
  });

  describe("#increaseObservationCardinalityNext", () => {
    it("can only be called after initialize", async () => {
      await expect(pool.increaseObservationCardinalityNext(2)).to.be.revertedWithCustomError(pool, "LOK");
    });

    it("emits an event including both old and new", async () => {
      await pool.initialize(encodePriceSqrt(1n, 1n));
      await expect(pool.increaseObservationCardinalityNext(2))
        .to.emit(pool, "IncreaseObservationCardinalityNext")
        .withArgs(1, 2);
    });

    it("does not emit an event for no op call", async () => {
      await pool.initialize(encodePriceSqrt(1n, 1n));
      await pool.increaseObservationCardinalityNext(3);
      await expect(pool.increaseObservationCardinalityNext(2)).to.not.emit(
        pool,
        "IncreaseObservationCardinalityNext"
      );
    });

    it("does not change cardinality next if less than current", async () => {
      await pool.initialize(encodePriceSqrt(1n, 1n));
      await pool.increaseObservationCardinalityNext(3);
      await pool.increaseObservationCardinalityNext(2);
      expect((await pool.slot0()).observationCardinalityNext).to.eq(3);
    });

    it("increases cardinality and cardinality next first time", async () => {
      await pool.initialize(encodePriceSqrt(1n, 1n));
      await pool.increaseObservationCardinalityNext(2);
      const { observationCardinality, observationCardinalityNext } = await pool.slot0();
      expect(observationCardinality).to.eq(1);
      expect(observationCardinalityNext).to.eq(2);
    });
  });

  describe("#mint", () => {
    it("fails if not initialized", async () => {
      await expect(
        mint(await wallet.getAddress(), -tickSpacing, tickSpacing, 1)
      ).to.be.revertedWithCustomError(pool, "LOK");
    });

    describe("after initialization", () => {
      beforeEach("initialize the pool at price of 10:1", async () => {
        await pool.initialize(encodePriceSqrt(1n, 10n));
        await mint(await wallet.getAddress(), minTick, maxTick, 3161);
      });

      describe("failure cases", () => {
        it("fails if tickLower greater than tickUpper", async () => {
          await expect(mint(await wallet.getAddress(), 1, 0, 1)).to.be.reverted;
        });

        it("fails if tickLower less than min tick", async () => {
          await expect(mint(await wallet.getAddress(), -887273, 0, 1)).to.be.reverted;
        });

        it("fails if tickUpper greater than max tick", async () => {
          await expect(mint(await wallet.getAddress(), 0, 887273, 1)).to.be.reverted;
        });

        it("fails if amount exceeds the max", async () => {
          const maxLiquidityGross = await pool.maxLiquidityPerTick();
          await expect(
            mint(
              await wallet.getAddress(),
              minTick + tickSpacing,
              maxTick - tickSpacing,
              maxLiquidityGross + 1n
            )
          ).to.be.reverted;
          await expect(
            mint(
              await wallet.getAddress(),
              minTick + tickSpacing,
              maxTick - tickSpacing,
              maxLiquidityGross
            )
          ).to.not.be.reverted;
        });

        it("fails if total amount at tick exceeds the max", async () => {
          await mint(
            await wallet.getAddress(),
            minTick + tickSpacing,
            maxTick - tickSpacing,
            1000
          );

          const maxLiquidityGross = await pool.maxLiquidityPerTick();
          await expect(
            mint(
              await wallet.getAddress(),
              minTick + tickSpacing,
              maxTick - tickSpacing,
              maxLiquidityGross - 1000n + 1n
            )
          ).to.be.reverted;
          await expect(
            mint(
              await wallet.getAddress(),
              minTick + tickSpacing * 2,
              maxTick - tickSpacing,
              maxLiquidityGross - 1000n + 1n
            )
          ).to.be.reverted;
          await expect(
            mint(
              await wallet.getAddress(),
              minTick + tickSpacing,
              maxTick - tickSpacing * 2,
              maxLiquidityGross - 1000n + 1n
            )
          ).to.be.reverted;
          await expect(
            mint(
              await wallet.getAddress(),
              minTick + tickSpacing,
              maxTick - tickSpacing,
              maxLiquidityGross - 1000n
            )
          ).to.not.be.reverted;
        });

        it("fails if amount is 0", async () => {
          await expect(
            mint(await wallet.getAddress(), minTick + tickSpacing, maxTick - tickSpacing, 0)
          ).to.be.reverted;
        });
      });

      describe("success cases", () => {
        it("initial balances", async () => {
          expect(await token0.balanceOf(await pool.getAddress())).to.eq(9996);
          expect(await token1.balanceOf(await pool.getAddress())).to.eq(1000);
        });

        it("initial tick", async () => {
          expect((await pool.slot0()).tick).to.eq(-23028);
        });

        describe("above current price", () => {
          it("transfers token0 only", async () => {
            await expect(mint(await wallet.getAddress(), -22980, 0, 10000))
              .to.emit(token0, "Transfer")
              .withArgs(await wallet.getAddress(), await pool.getAddress(), 21549)
              .to.not.emit(token1, "Transfer");
            expect(await token0.balanceOf(await pool.getAddress())).to.eq(9996 + 21549);
            expect(await token1.balanceOf(await pool.getAddress())).to.eq(1000);
          });

          it("max tick with max leverage", async () => {
            await mint(await wallet.getAddress(), maxTick - tickSpacing, maxTick, 2n ** 102n);
            expect(await token0.balanceOf(await pool.getAddress())).to.eq(9996 + 828011525);
            expect(await token1.balanceOf(await pool.getAddress())).to.eq(1000);
          });

          it("works for max tick", async () => {
            await expect(mint(await wallet.getAddress(), -22980, maxTick, 10000))
              .to.emit(token0, "Transfer")
              .withArgs(await wallet.getAddress(), await pool.getAddress(), 31549);
            expect(await token0.balanceOf(await pool.getAddress())).to.eq(9996 + 31549);
            expect(await token1.balanceOf(await pool.getAddress())).to.eq(1000);
          });

          it("removing works", async () => {
            await mint(await wallet.getAddress(), -240, 0, 10000);
            await pool.burn(-240, 0, 10000);
            const { amount0, amount1 } = await pool.collect.staticCall(
              await wallet.getAddress(),
              -240,
              0,
              MaxUint128,
              MaxUint128
            );
            expect(amount0, "amount0").to.eq(120);
            expect(amount1, "amount1").to.eq(0);
          });

          it("adds liquidity to liquidityGross", async () => {
            await mint(await wallet.getAddress(), -240, 0, 100);
            expect((await pool.ticks(-240)).liquidityGross).to.eq(100);
            expect((await pool.ticks(0)).liquidityGross).to.eq(100);
            expect((await pool.ticks(tickSpacing)).liquidityGross).to.eq(0);
            expect((await pool.ticks(tickSpacing * 2)).liquidityGross).to.eq(0);
            await mint(await wallet.getAddress(), -240, tickSpacing, 150);
            expect((await pool.ticks(-240)).liquidityGross).to.eq(250);
            expect((await pool.ticks(0)).liquidityGross).to.eq(100);
            expect((await pool.ticks(tickSpacing)).liquidityGross).to.eq(150);
            expect((await pool.ticks(tickSpacing * 2)).liquidityGross).to.eq(0);
            await mint(await wallet.getAddress(), 0, tickSpacing * 2, 60);
            expect((await pool.ticks(-240)).liquidityGross).to.eq(250);
            expect((await pool.ticks(0)).liquidityGross).to.eq(160);
            expect((await pool.ticks(tickSpacing)).liquidityGross).to.eq(150);
            expect((await pool.ticks(tickSpacing * 2)).liquidityGross).to.eq(60);
          });

          it("removes liquidity from liquidityGross", async () => {
            await mint(await wallet.getAddress(), -240, 0, 100);
            await mint(await wallet.getAddress(), -240, 0, 40);
            await pool.burn(-240, 0, 90);
            expect((await pool.ticks(-240)).liquidityGross).to.eq(50);
            expect((await pool.ticks(0)).liquidityGross).to.eq(50);
          });

          it("clears tick lower if last position is removed", async () => {
            await mint(await wallet.getAddress(), -240, 0, 100);
            await pool.burn(-240, 0, 100);
            const { liquidityGross, feeGrowthOutside0X128, feeGrowthOutside1X128 } =
              await pool.ticks(-240);
            expect(liquidityGross).to.eq(0);
            expect(feeGrowthOutside0X128).to.eq(0);
            expect(feeGrowthOutside1X128).to.eq(0);
          });

          it("clears tick upper if last position is removed", async () => {
            await mint(await wallet.getAddress(), -240, 0, 100);
            await pool.burn(-240, 0, 100);
            const { liquidityGross, feeGrowthOutside0X128, feeGrowthOutside1X128 } =
              await pool.ticks(0);
            expect(liquidityGross).to.eq(0);
            expect(feeGrowthOutside0X128).to.eq(0);
            expect(feeGrowthOutside1X128).to.eq(0);
          });

          it("only clears the tick that is not used at all", async () => {
            await mint(await wallet.getAddress(), -240, 0, 100);
            await mint(await wallet.getAddress(), -tickSpacing, 0, 250);
            await pool.burn(-240, 0, 100);

            let { liquidityGross, feeGrowthOutside0X128, feeGrowthOutside1X128 } =
              await pool.ticks(-240);
            expect(liquidityGross).to.eq(0);
            expect(feeGrowthOutside0X128).to.eq(0);
            expect(feeGrowthOutside1X128).to.eq(0);
            ({ liquidityGross, feeGrowthOutside0X128, feeGrowthOutside1X128 } = await pool.ticks(
              -tickSpacing
            ));
            expect(liquidityGross).to.eq(250);
            expect(feeGrowthOutside0X128).to.eq(0);
            expect(feeGrowthOutside1X128).to.eq(0);
          });

          it("does not write an observation", async () => {
            checkObservationEquals(await pool.observations(0), {
              tickCumulative: 0,
              blockTimestamp: TEST_POOL_START_TIME,
              initialized: true,
              secondsPerLiquidityCumulativeX128: 0,
            });
            await pool.advanceTime(1);
            await mint(await wallet.getAddress(), -240, 0, 100);
            checkObservationEquals(await pool.observations(0), {
              tickCumulative: 0,
              blockTimestamp: TEST_POOL_START_TIME,
              initialized: true,
              secondsPerLiquidityCumulativeX128: 0,
            });
          });
        });

        describe("including current price", () => {
          it("price within range: transfers current price of both tokens", async () => {
            await expect(
              mint(await wallet.getAddress(), minTick + tickSpacing, maxTick - tickSpacing, 100)
            )
              .to.emit(token0, "Transfer")
              .withArgs(await wallet.getAddress(), await pool.getAddress(), 317)
              .to.emit(token1, "Transfer")
              .withArgs(await wallet.getAddress(), await pool.getAddress(), 32);
            expect(await token0.balanceOf(await pool.getAddress())).to.eq(9996 + 317);
            expect(await token1.balanceOf(await pool.getAddress())).to.eq(1000 + 32);
          });

          it("initializes lower tick", async () => {
            await mint(await wallet.getAddress(), minTick + tickSpacing, maxTick - tickSpacing, 100);
            const { liquidityGross } = await pool.ticks(minTick + tickSpacing);
            expect(liquidityGross).to.eq(100);
          });

          it("initializes upper tick", async () => {
            await mint(await wallet.getAddress(), minTick + tickSpacing, maxTick - tickSpacing, 100);
            const { liquidityGross } = await pool.ticks(maxTick - tickSpacing);
            expect(liquidityGross).to.eq(100);
          });

          it("works for min/max tick", async () => {
            await expect(mint(await wallet.getAddress(), minTick, maxTick, 10000))
              .to.emit(token0, "Transfer")
              .withArgs(await wallet.getAddress(), await pool.getAddress(), 31623)
              .to.emit(token1, "Transfer")
              .withArgs(await wallet.getAddress(), await pool.getAddress(), 3163);
            expect(await token0.balanceOf(await pool.getAddress())).to.eq(9996 + 31623);
            expect(await token1.balanceOf(await pool.getAddress())).to.eq(1000 + 3163);
          });

          it("removing works", async () => {
            await mint(await wallet.getAddress(), minTick + tickSpacing, maxTick - tickSpacing, 100);
            await pool.burn(minTick + tickSpacing, maxTick - tickSpacing, 100);
            const { amount0, amount1 } = await pool.collect.staticCall(
              await wallet.getAddress(),
              minTick + tickSpacing,
              maxTick - tickSpacing,
              MaxUint128,
              MaxUint128
            );
            expect(amount0, "amount0").to.eq(316);
            expect(amount1, "amount1").to.eq(31);
          });

          it("writes an observation", async () => {
            checkObservationEquals(await pool.observations(0), {
              tickCumulative: 0,
              blockTimestamp: TEST_POOL_START_TIME,
              initialized: true,
              secondsPerLiquidityCumulativeX128: 0,
            });
            await pool.advanceTime(1);
            await mint(await wallet.getAddress(), minTick, maxTick, 100);
            checkObservationEquals(await pool.observations(0), {
              tickCumulative: -23028,
              blockTimestamp: TEST_POOL_START_TIME + 1,
              initialized: true,
              secondsPerLiquidityCumulativeX128: "107650226801941937191829992860413859",
            });
          });
        });

        describe("below current price", () => {
          it("transfers token1 only", async () => {
            await expect(mint(await wallet.getAddress(), -46080, -23040, 10000))
              .to.emit(token1, "Transfer")
              .withArgs(await wallet.getAddress(), await pool.getAddress(), 2162)
              .to.not.emit(token0, "Transfer");
            expect(await token0.balanceOf(await pool.getAddress())).to.eq(9996);
            expect(await token1.balanceOf(await pool.getAddress())).to.eq(1000 + 2162);
          });

          it("min tick with max leverage", async () => {
            await mint(await wallet.getAddress(), minTick, minTick + tickSpacing, 2n ** 102n);
            expect(await token0.balanceOf(await pool.getAddress())).to.eq(9996);
            expect(await token1.balanceOf(await pool.getAddress())).to.eq(1000 + 828011520);
          });

          it("works for min tick", async () => {
            await expect(mint(await wallet.getAddress(), minTick, -23040, 10000))
              .to.emit(token1, "Transfer")
              .withArgs(await wallet.getAddress(), await pool.getAddress(), 3161);
            expect(await token0.balanceOf(await pool.getAddress())).to.eq(9996);
            expect(await token1.balanceOf(await pool.getAddress())).to.eq(1000 + 3161);
          });

          it("removing works", async () => {
            await mint(await wallet.getAddress(), -46080, -46020, 10000);
            await pool.burn(-46080, -46020, 10000);
            const { amount0, amount1 } = await pool.collect.staticCall(
              await wallet.getAddress(),
              -46080,
              -46020,
              MaxUint128,
              MaxUint128
            );
            expect(amount0, "amount0").to.eq(0);
            expect(amount1, "amount1").to.eq(3);
          });

          it("does not write an observation", async () => {
            checkObservationEquals(await pool.observations(0), {
              tickCumulative: 0,
              blockTimestamp: TEST_POOL_START_TIME,
              initialized: true,
              secondsPerLiquidityCumulativeX128: 0,
            });
            await pool.advanceTime(1);
            await mint(await wallet.getAddress(), -46080, -23040, 100);
            checkObservationEquals(await pool.observations(0), {
              tickCumulative: 0,
              blockTimestamp: TEST_POOL_START_TIME,
              initialized: true,
              secondsPerLiquidityCumulativeX128: 0,
            });
          });
        });
      });

      it("protocol fees accumulate as expected during swap", async () => {
        await pool.setFeeProtocol(6, 6);

        await mint(
          await wallet.getAddress(),
          minTick + tickSpacing,
          maxTick - tickSpacing,
          expandTo18Decimals(1)
        );
        await swapExact0For1(expandTo18Decimals(1) / 10n, wallet);
        await swapExact1For0(expandTo18Decimals(1) / 100n, wallet);

        let { token0: token0ProtocolFees, token1: token1ProtocolFees } = await pool.protocolFees();
        expect(token0ProtocolFees).to.eq(50000000000000n);
        expect(token1ProtocolFees).to.eq(5000000000000n);
      });

      it("positions are protected before protocol fee is turned on", async () => {
        await mint(
          await wallet.getAddress(),
          minTick + tickSpacing,
          maxTick - tickSpacing,
          expandTo18Decimals(1)
        );
        await swapExact0For1(expandTo18Decimals(1) / 10n, wallet);
        await swapExact1For0(expandTo18Decimals(1) / 100n, wallet);

        let { token0: token0ProtocolFees, token1: token1ProtocolFees } = await pool.protocolFees();
        expect(token0ProtocolFees).to.eq(0);
        expect(token1ProtocolFees).to.eq(0);

        await pool.setFeeProtocol(6, 6);
        ({ token0: token0ProtocolFees, token1: token1ProtocolFees } = await pool.protocolFees());
        expect(token0ProtocolFees).to.eq(0);
        expect(token1ProtocolFees).to.eq(0);
      });

      it("poke is not allowed on uninitialized position", async () => {
        await mint(
          await other.getAddress(),
          minTick + tickSpacing,
          maxTick - tickSpacing,
          expandTo18Decimals(1)
        );
        await swapExact0For1(expandTo18Decimals(1) / 10n, wallet);
        await swapExact1For0(expandTo18Decimals(1) / 100n, wallet);

        await expect(pool.burn(minTick + tickSpacing, maxTick - tickSpacing, 0)).to.be.reverted;

        await mint(await wallet.getAddress(), minTick + tickSpacing, maxTick - tickSpacing, 1);
        let {
          liquidity,
          feeGrowthInside0LastX128,
          feeGrowthInside1LastX128,
          tokensOwed1,
          tokensOwed0,
        } = await pool.positions(
          getPositionKey(await wallet.getAddress(), minTick + tickSpacing, maxTick - tickSpacing)
        );
        expect(liquidity).to.eq(1);
        expect(feeGrowthInside0LastX128).to.eq(102084710076281216349243831104605583n);
        expect(feeGrowthInside1LastX128).to.eq(10208471007628121634924383110460558n);
        expect(tokensOwed0, "tokens owed 0 before").to.eq(0);
        expect(tokensOwed1, "tokens owed 1 before").to.eq(0);

        await pool.burn(minTick + tickSpacing, maxTick - tickSpacing, 1);
        ({
          liquidity,
          feeGrowthInside0LastX128,
          feeGrowthInside1LastX128,
          tokensOwed1,
          tokensOwed0,
        } = await pool.positions(
          getPositionKey(await wallet.getAddress(), minTick + tickSpacing, maxTick - tickSpacing)
        ));
        expect(liquidity).to.eq(0);
        expect(feeGrowthInside0LastX128).to.eq(102084710076281216349243831104605583n);
        expect(feeGrowthInside1LastX128).to.eq(10208471007628121634924383110460558n);
        expect(tokensOwed0, "tokens owed 0 after").to.eq(3);
        expect(tokensOwed1, "tokens owed 1 after").to.eq(0);
      });
    });
  });

  describe("#burn", () => {
    beforeEach("initialize at zero tick", () => initializeAtZeroTick(pool));

    async function checkTickIsClear(tick: number) {
      const { liquidityGross, feeGrowthOutside0X128, feeGrowthOutside1X128, liquidityNet } =
        await pool.ticks(tick);
      expect(liquidityGross).to.eq(0);
      expect(feeGrowthOutside0X128).to.eq(0);
      expect(feeGrowthOutside1X128).to.eq(0);
      expect(liquidityNet).to.eq(0);
    }

    async function checkTickIsNotClear(tick: number) {
      const { liquidityGross } = await pool.ticks(tick);
      expect(liquidityGross).to.not.eq(0);
    }

    it("does not clear the position fee growth snapshot if no more liquidity", async () => {
      await pool.advanceTime(10);
      await mint(await other.getAddress(), minTick, maxTick, expandTo18Decimals(1));
      await swapExact0For1(expandTo18Decimals(1), wallet);
      await swapExact1For0(expandTo18Decimals(1), wallet);
      await pool.connect(other).burn(minTick, maxTick, expandTo18Decimals(1));
      const {
        liquidity,
        tokensOwed0,
        tokensOwed1,
        feeGrowthInside0LastX128,
        feeGrowthInside1LastX128,
      } = await pool.positions(getPositionKey(await other.getAddress(), minTick, maxTick));
      expect(liquidity).to.eq(0);
      expect(tokensOwed0).to.not.eq(0);
      expect(tokensOwed1).to.not.eq(0);
      expect(feeGrowthInside0LastX128).to.eq(340282366920938463463374607431768211n);
      expect(feeGrowthInside1LastX128).to.eq(340282366920938576890830247744589365n);
    });

    it("clears the tick if its the last position using it", async () => {
      const tickLower = minTick + tickSpacing;
      const tickUpper = maxTick - tickSpacing;
      await pool.advanceTime(10);
      await mint(await wallet.getAddress(), tickLower, tickUpper, 1);
      await swapExact0For1(expandTo18Decimals(1), wallet);
      await pool.burn(tickLower, tickUpper, 1);
      await checkTickIsClear(tickLower);
      await checkTickIsClear(tickUpper);
    });

    it("clears only the lower tick if upper is still used", async () => {
      const tickLower = minTick + tickSpacing;
      const tickUpper = maxTick - tickSpacing;
      await pool.advanceTime(10);
      await mint(await wallet.getAddress(), tickLower, tickUpper, 1);
      await mint(await wallet.getAddress(), tickLower + tickSpacing, tickUpper, 1);
      await swapExact0For1(expandTo18Decimals(1), wallet);
      await pool.burn(tickLower, tickUpper, 1);
      await checkTickIsClear(tickLower);
      await checkTickIsNotClear(tickUpper);
    });

    it("clears only the upper tick if lower is still used", async () => {
      const tickLower = minTick + tickSpacing;
      const tickUpper = maxTick - tickSpacing;
      await pool.advanceTime(10);
      await mint(await wallet.getAddress(), tickLower, tickUpper, 1);
      await mint(await wallet.getAddress(), tickLower, tickUpper - tickSpacing, 1);
      await swapExact0For1(expandTo18Decimals(1), wallet);
      await pool.burn(tickLower, tickUpper, 1);
      await checkTickIsNotClear(tickLower);
      await checkTickIsClear(tickUpper);
    });
  });

  const initializeLiquidityAmount = expandTo18Decimals(2);
  async function initializeAtZeroTick(pool: Contract): Promise<void> {
    await pool.initialize(encodePriceSqrt(1n, 1n));
    const tickSpacing = Number(await pool.tickSpacing());
    const [min, max] = [getMinTick(tickSpacing), getMaxTick(tickSpacing)];
    await mint(await wallet.getAddress(), min, max, initializeLiquidityAmount);
  }

  describe("#observe", () => {
    beforeEach(() => initializeAtZeroTick(pool));

    it("current tick accumulator increases by tick over time", async () => {
      let {
        tickCumulatives: [tickCumulative],
      } = await pool.observe([0]);
      expect(tickCumulative).to.eq(0);
      await pool.advanceTime(10);
      ({
        tickCumulatives: [tickCumulative],
      } = await pool.observe([0]));
      expect(tickCumulative).to.eq(0);
    });

    it("current tick accumulator after single swap", async () => {
      await swapExact0For1(1000, wallet);
      await pool.advanceTime(4);
      let {
        tickCumulatives: [tickCumulative],
      } = await pool.observe([0]);
      expect(tickCumulative).to.eq(-4);
    });

    it("current tick accumulator after two swaps", async () => {
      await swapExact0For1(expandTo18Decimals(1) / 2n, wallet);
      expect((await pool.slot0()).tick).to.eq(-4452);
      await pool.advanceTime(4);
      await swapExact1For0(expandTo18Decimals(1) / 4n, wallet);
      expect((await pool.slot0()).tick).to.eq(-1558);
      await pool.advanceTime(6);
      let {
        tickCumulatives: [tickCumulative],
      } = await pool.observe([0]);
      expect(tickCumulative).to.eq(-27156);
    });
  });

  describe("miscellaneous mint tests", () => {
    beforeEach("initialize at zero tick", async () => {
      pool = await createPool(FeeAmount.LOW, TICK_SPACINGS[FeeAmount.LOW]);
      await initializeAtZeroTick(pool);
    });

    it("mint to the right of the current price", async () => {
      const liquidityDelta = 1000;
      const lowerTick = tickSpacing;
      const upperTick = tickSpacing * 2;

      const liquidityBefore = await pool.liquidity();

      const b0 = await token0.balanceOf(await pool.getAddress());
      const b1 = await token1.balanceOf(await pool.getAddress());

      await mint(await wallet.getAddress(), lowerTick, upperTick, liquidityDelta);

      const liquidityAfter = await pool.liquidity();
      expect(liquidityAfter).to.be.gte(liquidityBefore);

      expect((await token0.balanceOf(await pool.getAddress())) - b0).to.eq(1);
      expect((await token1.balanceOf(await pool.getAddress())) - b1).to.eq(0);
    });

    it("mint to the left of the current price", async () => {
      const liquidityDelta = 1000;
      const lowerTick = -tickSpacing * 2;
      const upperTick = -tickSpacing;

      const liquidityBefore = await pool.liquidity();

      const b0 = await token0.balanceOf(await pool.getAddress());
      const b1 = await token1.balanceOf(await pool.getAddress());

      await mint(await wallet.getAddress(), lowerTick, upperTick, liquidityDelta);

      const liquidityAfter = await pool.liquidity();
      expect(liquidityAfter).to.be.gte(liquidityBefore);

      expect((await token0.balanceOf(await pool.getAddress())) - b0).to.eq(0);
      expect((await token1.balanceOf(await pool.getAddress())) - b1).to.eq(1);
    });

    it("mint within the current price", async () => {
      const liquidityDelta = 1000;
      const lowerTick = -tickSpacing;
      const upperTick = tickSpacing;

      const liquidityBefore = await pool.liquidity();

      const b0 = await token0.balanceOf(await pool.getAddress());
      const b1 = await token1.balanceOf(await pool.getAddress());

      await mint(await wallet.getAddress(), lowerTick, upperTick, liquidityDelta);

      const liquidityAfter = await pool.liquidity();
      expect(liquidityAfter).to.be.gte(liquidityBefore);

      expect((await token0.balanceOf(await pool.getAddress())) - b0).to.eq(1);
      expect((await token1.balanceOf(await pool.getAddress())) - b1).to.eq(1);
    });

    it("cannot remove more than the entire position", async () => {
      const lowerTick = -tickSpacing;
      const upperTick = tickSpacing;
      await mint(await wallet.getAddress(), lowerTick, upperTick, expandTo18Decimals(1000));
      await expect(pool.burn(lowerTick, upperTick, expandTo18Decimals(1001))).to.be.reverted;
    });

    it("collect fees within the current price after swap", async () => {
      const liquidityDelta = expandTo18Decimals(100);
      const lowerTick = -tickSpacing * 100;
      const upperTick = tickSpacing * 100;

      await mint(await wallet.getAddress(), lowerTick, upperTick, liquidityDelta);

      const liquidityBefore = await pool.liquidity();

      const amount0In = expandTo18Decimals(1);
      await swapExact0For1(amount0In, wallet);

      const liquidityAfter = await pool.liquidity();
      expect(liquidityAfter, "k increases").to.be.gte(liquidityBefore);

      const token0BalanceBeforePool = await token0.balanceOf(await pool.getAddress());
      const token1BalanceBeforePool = await token1.balanceOf(await pool.getAddress());
      const token0BalanceBeforeWallet = await token0.balanceOf(await wallet.getAddress());
      const token1BalanceBeforeWallet = await token1.balanceOf(await wallet.getAddress());

      await pool.burn(lowerTick, upperTick, 0);
      await pool.collect(await wallet.getAddress(), lowerTick, upperTick, MaxUint128, MaxUint128);

      await pool.burn(lowerTick, upperTick, 0);
      const { amount0: fees0, amount1: fees1 } = await pool.collect.staticCall(
        await wallet.getAddress(),
        lowerTick,
        upperTick,
        MaxUint128,
        MaxUint128
      );
      expect(fees0).to.be.eq(0);
      expect(fees1).to.be.eq(0);

      const token0BalanceAfterWallet = await token0.balanceOf(await wallet.getAddress());
      const token1BalanceAfterWallet = await token1.balanceOf(await wallet.getAddress());
      const token0BalanceAfterPool = await token0.balanceOf(await pool.getAddress());
      const token1BalanceAfterPool = await token1.balanceOf(await pool.getAddress());

      expect(token0BalanceAfterWallet).to.be.gt(token0BalanceBeforeWallet);
      expect(token1BalanceAfterWallet).to.be.eq(token1BalanceBeforeWallet);

      expect(token0BalanceAfterPool).to.be.lt(token0BalanceBeforePool);
      expect(token1BalanceAfterPool).to.be.eq(token1BalanceBeforePool);
    });
  });

  describe("post-initialize at medium fee", () => {
    describe("k (implicit)", () => {
      it("returns 0 before initialization", async () => {
        expect(await pool.liquidity()).to.eq(0);
      });

      describe("post initialized", () => {
        beforeEach(() => initializeAtZeroTick(pool));

        it("returns initial liquidity", async () => {
          expect(await pool.liquidity()).to.eq(expandTo18Decimals(2));
        });

        it("returns in supply in range", async () => {
          await mint(await wallet.getAddress(), -tickSpacing, tickSpacing, expandTo18Decimals(3));
          expect(await pool.liquidity()).to.eq(expandTo18Decimals(5));
        });

        it("excludes supply at tick above current tick", async () => {
          await mint(
            await wallet.getAddress(),
            tickSpacing,
            tickSpacing * 2,
            expandTo18Decimals(3)
          );
          expect(await pool.liquidity()).to.eq(expandTo18Decimals(2));
        });

        it("excludes supply at tick below current tick", async () => {
          await mint(
            await wallet.getAddress(),
            -tickSpacing * 2,
            -tickSpacing,
            expandTo18Decimals(3)
          );
          expect(await pool.liquidity()).to.eq(expandTo18Decimals(2));
        });

        it("updates correctly when exiting range", async () => {
          const kBefore = await pool.liquidity();
          expect(kBefore).to.be.eq(expandTo18Decimals(2));

          const liquidityDelta = expandTo18Decimals(1);
          const lowerTick = 0;
          const upperTick = tickSpacing;
          await mint(await wallet.getAddress(), lowerTick, upperTick, liquidityDelta);

          const kAfter = await pool.liquidity();
          expect(kAfter).to.be.eq(expandTo18Decimals(3));

          await swapExact0For1(1, wallet);
          const { tick } = await pool.slot0();
          expect(tick).to.be.eq(-1);

          const kAfterSwap = await pool.liquidity();
          expect(kAfterSwap).to.be.eq(expandTo18Decimals(2));
        });

        it("updates correctly when entering range", async () => {
          const kBefore = await pool.liquidity();
          expect(kBefore).to.be.eq(expandTo18Decimals(2));

          const liquidityDelta = expandTo18Decimals(1);
          const lowerTick = -tickSpacing;
          const upperTick = 0;
          await mint(await wallet.getAddress(), lowerTick, upperTick, liquidityDelta);

          const kAfter = await pool.liquidity();
          expect(kAfter).to.be.eq(kBefore);

          await swapExact0For1(1, wallet);
          const { tick } = await pool.slot0();
          expect(tick).to.be.eq(-1);

          const kAfterSwap = await pool.liquidity();
          expect(kAfterSwap).to.be.eq(expandTo18Decimals(3));
        });
      });
    });
  });

  describe("limit orders", () => {
    beforeEach("initialize at tick 0", () => initializeAtZeroTick(pool));

    it("limit selling 0 for 1 at tick 0 thru 1", async () => {
      await expect(mint(await wallet.getAddress(), 0, 120, expandTo18Decimals(1)))
        .to.emit(token0, "Transfer")
        .withArgs(await wallet.getAddress(), await pool.getAddress(), 5981737760509663n);

      await swapExact1For0(expandTo18Decimals(2), other);
      await expect(pool.burn(0, 120, expandTo18Decimals(1)))
        .to.emit(pool, "Burn")
        .withArgs(await wallet.getAddress(), 0, 120, expandTo18Decimals(1), 0, 6017734268818165n)
        .to.not.emit(token0, "Transfer")
        .to.not.emit(token1, "Transfer");

      await expect(pool.collect(await wallet.getAddress(), 0, 120, MaxUint128, MaxUint128))
        .to.emit(token1, "Transfer")
        .withArgs(
          await pool.getAddress(),
          await wallet.getAddress(),
          6017734268818165n + 18107525382602n
        )
        .to.not.emit(token0, "Transfer");

      expect((await pool.slot0()).tick).to.be.gte(120);
    });

    it("limit selling 1 for 0 at tick 0 thru -1", async () => {
      await expect(mint(await wallet.getAddress(), -120, 0, expandTo18Decimals(1)))
        .to.emit(token1, "Transfer")
        .withArgs(await wallet.getAddress(), await pool.getAddress(), 5981737760509663n);

      await swapExact0For1(expandTo18Decimals(2), other);
      await expect(pool.burn(-120, 0, expandTo18Decimals(1)))
        .to.emit(pool, "Burn")
        .withArgs(await wallet.getAddress(), -120, 0, expandTo18Decimals(1), 6017734268818165n, 0)
        .to.not.emit(token0, "Transfer")
        .to.not.emit(token1, "Transfer");

      await expect(pool.collect(await wallet.getAddress(), -120, 0, MaxUint128, MaxUint128))
        .to.emit(token0, "Transfer")
        .withArgs(
          await pool.getAddress(),
          await wallet.getAddress(),
          6017734268818165n + 18107525382602n
        );

      expect((await pool.slot0()).tick).to.be.lt(-120);
    });

    describe("fee is on", () => {
      beforeEach(() => pool.setFeeProtocol(6, 6));

      it("limit selling 0 for 1 at tick 0 thru 1", async () => {
        await expect(mint(await wallet.getAddress(), 0, 120, expandTo18Decimals(1)))
          .to.emit(token0, "Transfer")
          .withArgs(await wallet.getAddress(), await pool.getAddress(), 5981737760509663n);

        await swapExact1For0(expandTo18Decimals(2), other);
        await expect(pool.burn(0, 120, expandTo18Decimals(1)))
          .to.emit(pool, "Burn")
          .withArgs(await wallet.getAddress(), 0, 120, expandTo18Decimals(1), 0, 6017734268818165n)
          .to.not.emit(token0, "Transfer")
          .to.not.emit(token1, "Transfer");

        await expect(pool.collect(await wallet.getAddress(), 0, 120, MaxUint128, MaxUint128))
          .to.emit(token1, "Transfer")
          .withArgs(
            await pool.getAddress(),
            await wallet.getAddress(),
            6017734268818165n + 15089604485501n
          )
          .to.not.emit(token0, "Transfer");

        expect((await pool.slot0()).tick).to.be.gte(120);
      });

      it("limit selling 1 for 0 at tick 0 thru -1", async () => {
        await expect(mint(await wallet.getAddress(), -120, 0, expandTo18Decimals(1)))
          .to.emit(token1, "Transfer")
          .withArgs(await wallet.getAddress(), await pool.getAddress(), 5981737760509663n);

        await swapExact0For1(expandTo18Decimals(2), other);
        await expect(pool.burn(-120, 0, expandTo18Decimals(1)))
          .to.emit(pool, "Burn")
          .withArgs(await wallet.getAddress(), -120, 0, expandTo18Decimals(1), 6017734268818165n, 0)
          .to.not.emit(token0, "Transfer")
          .to.not.emit(token1, "Transfer");

        await expect(pool.collect(await wallet.getAddress(), -120, 0, MaxUint128, MaxUint128))
          .to.emit(token0, "Transfer")
          .withArgs(
            await pool.getAddress(),
            await wallet.getAddress(),
            6017734268818165n + 15089604485501n
          );

        expect((await pool.slot0()).tick).to.be.lt(-120);
      });
    });
  });

  describe("#collect", () => {
    beforeEach(async () => {
      pool = await createPool(FeeAmount.LOW, TICK_SPACINGS[FeeAmount.LOW]);
      await pool.initialize(encodePriceSqrt(1n, 1n));
    });

    it("works with multiple LPs", async () => {
      await mint(await wallet.getAddress(), minTick, maxTick, expandTo18Decimals(1));
      await mint(
        await wallet.getAddress(),
        minTick + tickSpacing,
        maxTick - tickSpacing,
        expandTo18Decimals(2)
      );

      await swapExact0For1(expandTo18Decimals(1), wallet);

      await pool.burn(minTick, maxTick, 0);
      await pool.burn(minTick + tickSpacing, maxTick - tickSpacing, 0);

      const { tokensOwed0: tokensOwed0Position0 } = await pool.positions(
        getPositionKey(await wallet.getAddress(), minTick, maxTick)
      );
      const { tokensOwed0: tokensOwed0Position1 } = await pool.positions(
        getPositionKey(await wallet.getAddress(), minTick + tickSpacing, maxTick - tickSpacing)
      );

      expect(tokensOwed0Position0).to.be.eq(166666666666667n);
      expect(tokensOwed0Position1).to.be.eq(333333333333334n);
    });

    describe("works across large increases", () => {
      beforeEach(async () => {
        await mint(await wallet.getAddress(), minTick, maxTick, expandTo18Decimals(1));
      });

      const magicNumber = 115792089237316195423570985008687907852929702298719625575994n;

      it("works just before the cap binds", async () => {
        await pool.setFeeGrowthGlobal0X128(magicNumber);
        await pool.burn(minTick, maxTick, 0);

        const { tokensOwed0, tokensOwed1 } = await pool.positions(
          getPositionKey(await wallet.getAddress(), minTick, maxTick)
        );

        expect(tokensOwed0).to.be.eq(MaxUint128 - 1n);
        expect(tokensOwed1).to.be.eq(0);
      });

      it("works just after the cap binds", async () => {
        await pool.setFeeGrowthGlobal0X128(magicNumber + 1n);
        await pool.burn(minTick, maxTick, 0);

        const { tokensOwed0, tokensOwed1 } = await pool.positions(
          getPositionKey(await wallet.getAddress(), minTick, maxTick)
        );

        expect(tokensOwed0).to.be.eq(MaxUint128);
        expect(tokensOwed1).to.be.eq(0);
      });

      it("works well after the cap binds", async () => {
        await pool.setFeeGrowthGlobal0X128(ethers.MaxUint256);
        await pool.burn(minTick, maxTick, 0);

        const { tokensOwed0, tokensOwed1 } = await pool.positions(
          getPositionKey(await wallet.getAddress(), minTick, maxTick)
        );

        expect(tokensOwed0).to.be.eq(MaxUint128);
        expect(tokensOwed1).to.be.eq(0);
      });
    });

    describe("works across overflow boundaries", () => {
      beforeEach(async () => {
        await pool.setFeeGrowthGlobal0X128(ethers.MaxUint256);
        await pool.setFeeGrowthGlobal1X128(ethers.MaxUint256);
        await mint(await wallet.getAddress(), minTick, maxTick, expandTo18Decimals(10));
      });

      it("token0", async () => {
        await swapExact0For1(expandTo18Decimals(1), wallet);
        await pool.burn(minTick, maxTick, 0);
        const { amount0, amount1 } = await pool.collect.staticCall(
          await wallet.getAddress(),
          minTick,
          maxTick,
          MaxUint128,
          MaxUint128
        );
        expect(amount0).to.be.eq(499999999999999n);
        expect(amount1).to.be.eq(0);
      });

      it("token1", async () => {
        await swapExact1For0(expandTo18Decimals(1), wallet);
        await pool.burn(minTick, maxTick, 0);
        const { amount0, amount1 } = await pool.collect.staticCall(
          await wallet.getAddress(),
          minTick,
          maxTick,
          MaxUint128,
          MaxUint128
        );
        expect(amount0).to.be.eq(0);
        expect(amount1).to.be.eq(499999999999999n);
      });

      it("token0 and token1", async () => {
        await swapExact0For1(expandTo18Decimals(1), wallet);
        await swapExact1For0(expandTo18Decimals(1), wallet);
        await pool.burn(minTick, maxTick, 0);
        const { amount0, amount1 } = await pool.collect.staticCall(
          await wallet.getAddress(),
          minTick,
          maxTick,
          MaxUint128,
          MaxUint128
        );
        expect(amount0).to.be.eq(499999999999999n);
        expect(amount1).to.be.eq(500000000000000n);
      });
    });
  });
});
