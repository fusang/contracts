// @ts-nocheck - Hardhat contracts use dynamic methods not typed in BaseContract
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Contract, Signer } from "ethers";
import { expect } from "./shared/expect";

import { poolFixture } from "./shared/fixtures";

import {
  FeeAmount,
  TICK_SPACINGS,
  createPoolFunctions,
  PoolFunctions,
  createMultiPoolFunctions,
  encodePriceSqrt,
  getMinTick,
  getMaxTick,
  expandTo18Decimals,
} from "./shared/utilities";

const feeAmount = FeeAmount.MEDIUM;
const tickSpacing = TICK_SPACINGS[feeAmount];

describe("UniswapV3Router", () => {
  let wallet: Signer, other: Signer;

  let token0: Contract;
  let token1: Contract;
  let token2: Contract;
  let factory: Contract;
  let pool0: Contract;
  let pool1: Contract;

  let pool0Functions: PoolFunctions;
  let pool1Functions: PoolFunctions;

  let minTick: number;
  let maxTick: number;

  let swapTargetCallee: Contract;
  let swapTargetRouter: Contract;

  const routerFixture = async () => {
    [wallet, other] = await ethers.getSigners();
    const fix = await poolFixture();

    const createPoolWrapped = async (
      amount: number,
      spacing: number,
      firstToken: Contract,
      secondToken: Contract
    ): Promise<[Contract, PoolFunctions]> => {
      const pool = await fix.createPool(amount, spacing, firstToken, secondToken);
      const poolFunctions = createPoolFunctions({
        swapTarget: fix.swapTargetCallee,
        token0: firstToken,
        token1: secondToken,
        pool,
      });
      return [pool, poolFunctions];
    };

    minTick = getMinTick(tickSpacing);
    maxTick = getMaxTick(tickSpacing);

    // default to the 30 bips pool
    const [p0, p0Functions] = await createPoolWrapped(feeAmount, tickSpacing, fix.token0, fix.token1);
    const [p1, p1Functions] = await createPoolWrapped(feeAmount, tickSpacing, fix.token1, fix.token2);

    return {
      token0: fix.token0,
      token1: fix.token1,
      token2: fix.token2,
      factory: fix.factory,
      pool0: p0,
      pool1: p1,
      pool0Functions: p0Functions,
      pool1Functions: p1Functions,
      swapTargetCallee: fix.swapTargetCallee,
      swapTargetRouter: fix.swapTargetRouter,
      minTick,
      maxTick,
    };
  };

  beforeEach("deploy first fixture", async () => {
    const fixture = await loadFixture(routerFixture);
    token0 = fixture.token0;
    token1 = fixture.token1;
    token2 = fixture.token2;
    factory = fixture.factory;
    pool0 = fixture.pool0;
    pool1 = fixture.pool1;
    pool0Functions = fixture.pool0Functions;
    pool1Functions = fixture.pool1Functions;
    swapTargetCallee = fixture.swapTargetCallee;
    swapTargetRouter = fixture.swapTargetRouter;
    minTick = fixture.minTick;
    maxTick = fixture.maxTick;
  });

  it("constructor initializes immutables", async () => {
    expect(await pool0.factory()).to.eq(await factory.getAddress());
    expect(await pool0.token0()).to.eq(await token0.getAddress());
    expect(await pool0.token1()).to.eq(await token1.getAddress());
    expect(await pool1.factory()).to.eq(await factory.getAddress());
    expect(await pool1.token0()).to.eq(await token1.getAddress());
    expect(await pool1.token1()).to.eq(await token2.getAddress());
  });

  describe("multi-swaps", () => {
    let inputToken: Contract;
    let outputToken: Contract;

    beforeEach("initialize both pools", async () => {
      inputToken = token0;
      outputToken = token2;

      await pool0.initialize(encodePriceSqrt(1n, 1n));
      await pool1.initialize(encodePriceSqrt(1n, 1n));

      await pool0Functions.mint(await wallet.getAddress(), minTick, maxTick, expandTo18Decimals(1));
      await pool1Functions.mint(await wallet.getAddress(), minTick, maxTick, expandTo18Decimals(1));
    });

    it("multi-swap", async () => {
      const token0OfPoolOutput = await pool1.token0();
      const ForExact0 = (await outputToken.getAddress()) === token0OfPoolOutput;

      const { swapForExact0Multi, swapForExact1Multi } = createMultiPoolFunctions({
        inputToken: token0,
        swapTarget: swapTargetRouter,
        poolInput: pool0,
        poolOutput: pool1,
      });

      const method = ForExact0 ? swapForExact0Multi : swapForExact1Multi;

      await expect(method(100n, await wallet.getAddress()))
        .to.emit(outputToken, "Transfer")
        .withArgs(await pool1.getAddress(), await wallet.getAddress(), 100)
        .to.emit(token1, "Transfer")
        .withArgs(await pool0.getAddress(), await pool1.getAddress(), 102)
        .to.emit(inputToken, "Transfer")
        .withArgs(await wallet.getAddress(), await pool0.getAddress(), 104);
    });
  });
});
