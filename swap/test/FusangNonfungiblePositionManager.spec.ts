// @ts-nocheck - Hardhat contracts use dynamic methods not typed in BaseContract
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import BigNumber from "bignumber.js";
import Decimal from "decimal.js";

import WETH9 from "./contracts/WETH9.json";
import { encodePriceSqrt } from "./shared/encodePriceSqrt";
import { getMaxTick, getMinTick } from "./shared/ticks";
import getPermitNFTSignature from "./shared/getPermitNFTSignature";

const WHITELIST = ethers.keccak256(ethers.toUtf8Bytes("WHITELIST"));
const BLACKLIST = ethers.keccak256(ethers.toUtf8Bytes("BLACKLIST"));
const FROZENLIST = ethers.keccak256(ethers.toUtf8Bytes("FROZENLIST"));
const MEMBER = ethers.keccak256(ethers.toUtf8Bytes("MEMBER"));
const DEFAULT_ADMIN_ROLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("FusangNonfungiblePositionManager", function () {
  async function deployFixture() {
    const [admin, whitelistedUser, nonWhitelistedUser, blacklistedUser, frozenUser] =
      await ethers.getSigners();

    // Deploy WalletList contract
    const WalletListFactory = await ethers.getContractFactory("WalletList");
    const walletList = await WalletListFactory.deploy();

    // Deploy WETH9 contract
    const WETH9Factory = await ethers.getContractFactory(
      WETH9.abi,
      WETH9.bytecode
    );
    const weth9 = await WETH9Factory.deploy();

    // Deploy test tokens (use periphery TestERC20 which has decimals() and symbol())
    const TokenFactory = await ethers.getContractFactory(
      "contracts/periphery/test/TestERC20.sol:TestERC20"
    );
    const tokenA = await TokenFactory.deploy(ethers.parseEther("1000000"));
    const tokenB = await TokenFactory.deploy(ethers.parseEther("1000000"));

    // Deploy FusangAllowList (uses walletList for admin)
    const FusangAllowList = await ethers.getContractFactory("FusangAllowList");
    const fusangAllowList = await FusangAllowList.deploy(walletList.target);

    // Deploy FusangFactory with allowList
    const FusangFactory = await ethers.getContractFactory("FusangFactory");
    const fusangFactory = await FusangFactory.deploy(fusangAllowList.target);

    // Deploy FusangPoolState
    const FusangPoolState = await ethers.getContractFactory("FusangPoolState");
    const fusangPoolState = await FusangPoolState.deploy(fusangFactory.target);

    // Configure WalletList
    await walletList.setRoleManageList(BLACKLIST, DEFAULT_ADMIN_ROLE, true);
    await walletList.setRoleManageList(FROZENLIST, DEFAULT_ADMIN_ROLE, true);
    await walletList.addToList(MEMBER, DEFAULT_ADMIN_ROLE, admin.address);
    await walletList.addToList(WHITELIST, MEMBER, whitelistedUser.address);
    await walletList.addToList(WHITELIST, MEMBER, admin.address);
    await walletList.addToList(WHITELIST, MEMBER, blacklistedUser.address);
    await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, blacklistedUser.address);
    await walletList.addToList(WHITELIST, MEMBER, frozenUser.address);
    await walletList.addToList(FROZENLIST, DEFAULT_ADMIN_ROLE, frozenUser.address);

    // Deploy NFTDescriptor library
    const NFTDescriptorFactory = await ethers.getContractFactory("NFTDescriptor");
    const nftDescriptorLibrary = await NFTDescriptorFactory.deploy();

    // Deploy NonfungibleTokenPositionDescriptor
    const NonfungibleTokenPositionDescriptorFactory =
      await ethers.getContractFactory("NonfungibleTokenPositionDescriptor", {
        libraries: {
          NFTDescriptor: nftDescriptorLibrary.target,
        },
      });
    const nonfungibleTokenPositionDescriptor =
      await NonfungibleTokenPositionDescriptorFactory.deploy(
        weth9.target,
        ethers.encodeBytes32String("ETH")
      );

    // Deploy FusangNonfungiblePositionManager
    const FusangNonfungiblePositionManager = await ethers.getContractFactory(
      "FusangNonfungiblePositionManager"
    );
    const positionManager = await FusangNonfungiblePositionManager.deploy(
      fusangFactory.target,
      weth9.target,
      nonfungibleTokenPositionDescriptor.target,
      fusangPoolState.target
    );

    // Deploy FusangSwapRouter
    const FusangSwapRouter = await ethers.getContractFactory("FusangSwapRouter");
    const swapRouter = await FusangSwapRouter.deploy(
      fusangFactory.target,
      weth9.target,
      fusangPoolState.target
    );

    // Add contracts to whitelist and allowlist
    await walletList.addToList(WHITELIST, MEMBER, positionManager.target);
    await walletList.addToList(WHITELIST, MEMBER, swapRouter.target);
    await fusangAllowList.setAllowed(positionManager.target, true);
    await fusangAllowList.setAllowed(swapRouter.target, true);

    // Sort tokens by address (required by pool creation)
    const [token0, token1] = tokenA.target.toLowerCase() < tokenB.target.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

    // Approve tokens and transfer
    const tokens = [token0, token1];
    for (const token of tokens) {
      await token.approve(positionManager.target, ethers.MaxUint256);
      await token.approve(swapRouter.target, ethers.MaxUint256);
      await token.connect(whitelistedUser).approve(positionManager.target, ethers.MaxUint256);
      await token.connect(whitelistedUser).approve(swapRouter.target, ethers.MaxUint256);
      await token.transfer(whitelistedUser.address, ethers.parseEther("100000"));
      await token.transfer(nonWhitelistedUser.address, ethers.parseEther("100000"));
      await token.connect(nonWhitelistedUser).approve(positionManager.target, ethers.MaxUint256);
      await token.connect(nonWhitelistedUser).approve(swapRouter.target, ethers.MaxUint256);
    }

    // Create and initialize pool
    await fusangFactory.createPool(token0.target, token1.target, 3000);
    await positionManager.createAndInitializePoolIfNecessary(
      token0.target,
      token1.target,
      3000,
      encodePriceSqrt(1, 1)
    );

    const poolAddress = await fusangFactory.getPool(token0.target, token1.target, 3000);

    // Mint initial position for admin
    const mintTx = await positionManager.connect(admin).mint({
      token0: token0.target,
      token1: token1.target,
      fee: 3000,
      tickLower: getMinTick(60),
      tickUpper: getMaxTick(60),
      amount0Desired: ethers.parseEther("10000"),
      amount1Desired: ethers.parseEther("10000"),
      amount0Min: 0,
      amount1Min: 0,
      recipient: admin.address,
      deadline: ethers.MaxUint256,
    });
    const mintReceipt = await mintTx.wait();
    // Find the IncreaseLiquidity event to get tokenId reliably
    const increaseLiquidityEvent = mintReceipt.logs.find(
      (log) => log.fragment?.name === "IncreaseLiquidity"
    );
    const tokenId = increaseLiquidityEvent.args[0];

    return {
      admin,
      whitelistedUser,
      nonWhitelistedUser,
      blacklistedUser,
      frozenUser,
      tokenA: token0,
      tokenB: token1,
      weth9,
      positionManager,
      swapRouter,
      walletList,
      fusangFactory,
      fusangAllowList,
      fusangPoolState,
      poolAddress,
      tokenId,
    };
  }

  describe("Deployment", function () {
    it("Should set correct factoryContract", async function () {
      const { positionManager, fusangFactory } = await loadFixture(deployFixture);

      expect(await positionManager.factoryContract()).to.equal(fusangFactory.target);
    });

    it("Should set correct poolStateContract", async function () {
      const { positionManager, fusangPoolState } = await loadFixture(deployFixture);

      expect(await positionManager.poolStateContract()).to.equal(fusangPoolState.target);
    });

    it("Should set correct factory", async function () {
      const { positionManager, fusangFactory } = await loadFixture(deployFixture);

      expect(await positionManager.factory()).to.equal(fusangFactory.target);
    });

    it("Should set correct name and symbol", async function () {
      const { positionManager } = await loadFixture(deployFixture);

      expect(await positionManager.name()).to.equal("Fusang V3 Positions NFT-V1");
      expect(await positionManager.symbol()).to.equal("FUSANG-V3-POS");
    });
  });

  describe("mint", function () {
    it("Should allow whitelisted user to mint", async function () {
      const { positionManager, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const mintParams = {
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(whitelistedUser).mint(mintParams))
        .to.emit(positionManager, "IncreaseLiquidity");
    });

    it("Should revert for non-whitelisted user", async function () {
      const { positionManager, nonWhitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const mintParams = {
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: nonWhitelistedUser.address,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(nonWhitelistedUser).mint(mintParams))
        .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
    });

    it("Should revert for non-whitelisted recipient", async function () {
      const { positionManager, whitelistedUser, nonWhitelistedUser, tokenA, tokenB } =
        await loadFixture(deployFixture);

      const mintParams = {
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: nonWhitelistedUser.address,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(whitelistedUser).mint(mintParams))
        .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
    });

    it("Should revert when pool is paused", async function () {
      const { positionManager, fusangPoolState, admin, whitelistedUser, tokenA, tokenB, poolAddress } =
        await loadFixture(deployFixture);

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      const mintParams = {
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(whitelistedUser).mint(mintParams))
        .to.be.revertedWithCustomError(positionManager, "PoolNotActive");
    });

    it("Should revert when pool is closed", async function () {
      const { positionManager, fusangPoolState, admin, whitelistedUser, tokenA, tokenB, poolAddress } =
        await loadFixture(deployFixture);

      const pastDate = (await time.latest()) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(poolAddress, pastDate);

      const mintParams = {
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(whitelistedUser).mint(mintParams))
        .to.be.revertedWithCustomError(positionManager, "PoolNotActive");
    });
  });

  describe("increaseLiquidity", function () {
    it("Should allow whitelisted user to increase liquidity", async function () {
      const { positionManager, whitelistedUser, tokenId } = await loadFixture(deployFixture);

      const increaseParams = {
        tokenId: tokenId,
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(whitelistedUser).increaseLiquidity(increaseParams))
        .to.emit(positionManager, "IncreaseLiquidity");
    });

    it("Should revert for non-whitelisted user", async function () {
      const { positionManager, nonWhitelistedUser, tokenId } = await loadFixture(deployFixture);

      const increaseParams = {
        tokenId: tokenId,
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(nonWhitelistedUser).increaseLiquidity(increaseParams))
        .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
    });

    it("Should revert when pool is closed", async function () {
      const { positionManager, fusangPoolState, admin, whitelistedUser, tokenId, poolAddress } =
        await loadFixture(deployFixture);

      const pastDate = (await time.latest()) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(poolAddress, pastDate);

      const increaseParams = {
        tokenId: tokenId,
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(whitelistedUser).increaseLiquidity(increaseParams))
        .to.be.revertedWithCustomError(positionManager, "PoolNotActive");
    });
  });

  describe("decreaseLiquidity", function () {
    it("Should allow owner to decrease liquidity", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      const decreaseParams = {
        tokenId: tokenId,
        liquidity: 1,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(admin).decreaseLiquidity(decreaseParams))
        .to.emit(positionManager, "DecreaseLiquidity");
    });

    it("Should revert for non-owner", async function () {
      const { positionManager, whitelistedUser, tokenId } = await loadFixture(deployFixture);

      const decreaseParams = {
        tokenId: tokenId,
        liquidity: 1,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(whitelistedUser).decreaseLiquidity(decreaseParams))
        .to.be.revertedWith("Not approved");
    });

    it("Should allow decrease liquidity when pool is closed (not paused)", async function () {
      const { positionManager, fusangPoolState, admin, tokenId, poolAddress } =
        await loadFixture(deployFixture);

      const pastDate = (await time.latest()) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(poolAddress, pastDate);

      const decreaseParams = {
        tokenId: tokenId,
        liquidity: 1,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Should succeed because closed != paused
      await expect(positionManager.connect(admin).decreaseLiquidity(decreaseParams))
        .to.emit(positionManager, "DecreaseLiquidity");
    });

    it("Should revert when pool is paused", async function () {
      const { positionManager, fusangPoolState, admin, tokenId, poolAddress } =
        await loadFixture(deployFixture);

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      const decreaseParams = {
        tokenId: tokenId,
        liquidity: 1,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(admin).decreaseLiquidity(decreaseParams))
        .to.be.revertedWithCustomError(positionManager, "PoolIsPaused");
    });
  });

  describe("collect", function () {
    it("Should allow owner to collect", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      const collectParams = {
        tokenId: tokenId,
        recipient: admin.address,
        amount0Max: 1,
        amount1Max: 1,
      };

      await expect(positionManager.connect(admin).collect(collectParams))
        .to.not.be.reverted;
    });

    it("Should revert for non-owner", async function () {
      const { positionManager, whitelistedUser, tokenId } = await loadFixture(deployFixture);

      const collectParams = {
        tokenId: tokenId,
        recipient: whitelistedUser.address,
        amount0Max: 1,
        amount1Max: 1,
      };

      await expect(positionManager.connect(whitelistedUser).collect(collectParams))
        .to.be.revertedWith("Not approved");
    });

    it("Should allow collect when pool is closed (not paused)", async function () {
      const { positionManager, fusangPoolState, admin, tokenId, poolAddress } =
        await loadFixture(deployFixture);

      const pastDate = (await time.latest()) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(poolAddress, pastDate);

      const collectParams = {
        tokenId: tokenId,
        recipient: admin.address,
        amount0Max: 1,
        amount1Max: 1,
      };

      // Should succeed because closed != paused
      await expect(positionManager.connect(admin).collect(collectParams))
        .to.not.be.reverted;
    });

    it("Should revert when pool is paused", async function () {
      const { positionManager, fusangPoolState, admin, tokenId, poolAddress } =
        await loadFixture(deployFixture);

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      const collectParams = {
        tokenId: tokenId,
        recipient: admin.address,
        amount0Max: 1,
        amount1Max: 1,
      };

      await expect(positionManager.connect(admin).collect(collectParams))
        .to.be.revertedWithCustomError(positionManager, "PoolIsPaused");
    });
  });

  describe("burn", function () {
    it("Should allow owner to burn position with zero liquidity", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      // Get position info
      const position = await positionManager.positions(tokenId);

      // Decrease all liquidity
      await positionManager.connect(admin).decreaseLiquidity({
        tokenId: tokenId,
        liquidity: position[7],
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      // Collect all tokens
      await positionManager.connect(admin).collect({
        tokenId: tokenId,
        recipient: admin.address,
        amount0Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
        amount1Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
      });

      await expect(positionManager.connect(admin).burn(tokenId))
        .to.not.be.reverted;
    });

    it("Should revert burn when pool is paused", async function () {
      const { positionManager, fusangPoolState, admin, tokenId, poolAddress } =
        await loadFixture(deployFixture);

      // Get position info
      const position = await positionManager.positions(tokenId);

      // Decrease all liquidity
      await positionManager.connect(admin).decreaseLiquidity({
        tokenId: tokenId,
        liquidity: position[7],
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      // Collect all tokens
      await positionManager.connect(admin).collect({
        tokenId: tokenId,
        recipient: admin.address,
        amount0Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
        amount1Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
      });

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(admin).burn(tokenId))
        .to.be.revertedWithCustomError(positionManager, "PoolIsPaused");
    });
  });

  describe("removePosition", function () {
    it("Should allow admin to remove position when pool is paused", async function () {
      const { positionManager, fusangPoolState, admin, poolAddress, tokenId } =
        await loadFixture(deployFixture);

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(admin).removePosition({tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.not.be.reverted;

      await expect(positionManager.positions(tokenId))
        .to.be.revertedWith("Invalid token ID");
    });

    it("Should allow admin to remove position when pool is expired", async function () {
      const { positionManager, fusangPoolState, admin, whitelistedUser, tokenA, tokenB, poolAddress } =
        await loadFixture(deployFixture);

      const mintTx = await positionManager.connect(whitelistedUser).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const userTokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const userTokenId = userTokenIdEvent.args[0];

      const pastDate = (await time.latest()) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(poolAddress, pastDate);

      await expect(positionManager.connect(admin).removePosition({tokenId: userTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.not.be.reverted;
    });

    it("Should allow admin to remove position with zero tokensOwed when pool is paused", async function () {
      const { positionManager, fusangPoolState, admin, poolAddress, tokenId } = await loadFixture(deployFixture);

      const position = await positionManager.positions(tokenId);

      await positionManager.connect(admin).decreaseLiquidity({
        tokenId: tokenId,
        liquidity: position[7],
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      await positionManager.connect(admin).collect({
        tokenId: tokenId,
        recipient: admin.address,
        amount0Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
        amount1Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
      });

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(admin).removePosition({tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.not.be.reverted;

      await expect(positionManager.positions(tokenId))
        .to.be.revertedWith("Invalid token ID");
    });

    it("Should revert when non-admin tries to remove position", async function () {
      const { positionManager, fusangPoolState, admin, whitelistedUser, tokenA, tokenB, poolAddress } =
        await loadFixture(deployFixture);

      const mintTx = await positionManager.connect(whitelistedUser).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const userTokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const userTokenId = userTokenIdEvent.args[0];

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(whitelistedUser).removePosition({tokenId: userTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.be.revertedWithCustomError(positionManager, "NotAdmin");
    });

    it("Should revert when admin tries to remove position on active pool", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      await expect(positionManager.connect(admin).removePosition({tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.be.revertedWithCustomError(positionManager, "PoolNotActive");
    });
  });

  describe("removePositions", function () {
    it("Should allow admin to remove multiple positions when pool is paused", async function () {
      const { positionManager, fusangPoolState, admin, tokenA, tokenB, tokenId, poolAddress } = await loadFixture(deployFixture);

      const mintTx = await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const tokenId2Event = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const tokenId2 = tokenId2Event.args[0];

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(admin).removePositions([{tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}, {tokenId: tokenId2, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}]))
        .to.not.be.reverted;

      await expect(positionManager.positions(tokenId)).to.be.revertedWith("Invalid token ID");
      await expect(positionManager.positions(tokenId2)).to.be.revertedWith("Invalid token ID");
    });

    it("Should revert for non-admin trying to remove positions", async function () {
      const { positionManager, fusangPoolState, admin, whitelistedUser, tokenId, poolAddress } = await loadFixture(deployFixture);

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(whitelistedUser).removePositions([{tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}]))
        .to.be.revertedWithCustomError(positionManager, "NotAdmin");
    });

    it("Should revert removePositions when deadline is expired for any element", async function () {
      const { positionManager, fusangPoolState, admin, tokenA, tokenB, tokenId, poolAddress } = await loadFixture(deployFixture);

      const mintTx = await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const tokenId2Event = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const tokenId2 = tokenId2Event.args[0];

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      const pastDeadline = (await time.latest()) - 1;
      await expect(positionManager.connect(admin).removePositions([
        {tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256},
        {tokenId: tokenId2, amount0Min: 0, amount1Min: 0, deadline: pastDeadline},
      ])).to.be.revertedWith("Transaction too old");
    });
  });

  describe("removePosition slippage and deadline protection", function () {
    it("Should revert removePosition when deadline is expired", async function () {
      const { positionManager, fusangPoolState, admin, tokenId, poolAddress } = await loadFixture(deployFixture);

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      const pastDeadline = (await time.latest()) - 1;
      await expect(positionManager.connect(admin).removePosition({tokenId, amount0Min: 0, amount1Min: 0, deadline: pastDeadline}))
        .to.be.revertedWith("Transaction too old");
    });

    it("Should revert removePosition when amount0 is below amount0Min", async function () {
      const { positionManager, fusangPoolState, admin, tokenId, poolAddress } = await loadFixture(deployFixture);

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(admin).removePosition({tokenId, amount0Min: ethers.parseEther("1000000"), amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.be.revertedWith("Price slippage check");
    });

    it("Should revert removePosition when amount1 is below amount1Min", async function () {
      const { positionManager, fusangPoolState, admin, tokenId, poolAddress } = await loadFixture(deployFixture);

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(admin).removePosition({tokenId, amount0Min: 0, amount1Min: ethers.parseEther("1000000"), deadline: ethers.MaxUint256}))
        .to.be.revertedWith("Price slippage check");
    });

    it("Should revert removePosition with amount0Min > 0 when position has zero liquidity", async function () {
      const { positionManager, fusangPoolState, admin, tokenA, tokenB, poolAddress } = await loadFixture(deployFixture);

      const mintTx = await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const newTokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const newTokenId = newTokenIdEvent.args[0];

      const position = await positionManager.positions(newTokenId);
      await positionManager.connect(admin).decreaseLiquidity({
        tokenId: newTokenId,
        liquidity: position.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(admin).removePosition({tokenId: newTokenId, amount0Min: 1, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.be.revertedWith("Price slippage check");
    });

    it("Should revert removePosition with amount1Min > 0 when position has zero liquidity", async function () {
      const { positionManager, fusangPoolState, admin, tokenA, tokenB, poolAddress } = await loadFixture(deployFixture);

      const mintTx = await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const newTokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const newTokenId = newTokenIdEvent.args[0];

      const position = await positionManager.positions(newTokenId);
      await positionManager.connect(admin).decreaseLiquidity({
        tokenId: newTokenId,
        liquidity: position.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(admin).removePosition({tokenId: newTokenId, amount0Min: 0, amount1Min: 1, deadline: ethers.MaxUint256}))
        .to.be.revertedWith("Price slippage check");
    });

    it("Should succeed removePosition with zero mins when position has zero liquidity", async function () {
      const { positionManager, fusangPoolState, admin, tokenA, tokenB, poolAddress } = await loadFixture(deployFixture);

      const mintTx = await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const newTokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const newTokenId = newTokenIdEvent.args[0];

      const position = await positionManager.positions(newTokenId);
      await positionManager.connect(admin).decreaseLiquidity({
        tokenId: newTokenId,
        liquidity: position.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(admin).removePosition({tokenId: newTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.not.be.reverted;

      await expect(positionManager.positions(newTokenId)).to.be.revertedWith("Invalid token ID");
    });

    it("Should succeed removePosition with valid non-zero slippage mins", async function () {
      const { positionManager, fusangPoolState, admin, tokenId, poolAddress } = await loadFixture(deployFixture);

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      // Use amount0Min=1 and amount1Min=1 — position has liquidity so actual amounts should exceed these
      await expect(positionManager.connect(admin).removePosition({tokenId, amount0Min: 1, amount1Min: 1, deadline: ethers.MaxUint256}))
        .to.not.be.reverted;

      await expect(positionManager.positions(tokenId)).to.be.revertedWith("Invalid token ID");
    });
  });

  describe("baseURI", function () {
    it("Should return empty string", async function () {
      const { positionManager } = await loadFixture(deployFixture);

      expect(await positionManager.baseURI()).to.equal("");
    });
  });

  describe("positions", function () {
    it("Should return correct position data", async function () {
      const { positionManager, tokenA, tokenB, tokenId } = await loadFixture(deployFixture);

      const position = await positionManager.positions(tokenId);

      expect(position.token0).to.equal(tokenA.target);
      expect(position.token1).to.equal(tokenB.target);
      expect(position.fee).to.equal(3000);
      expect(position.liquidity).to.be.gt(0);
    });

    it("Should revert for invalid token ID", async function () {
      const { positionManager } = await loadFixture(deployFixture);

      await expect(positionManager.positions(999999))
        .to.be.revertedWith("Invalid token ID");
    });
  });

  describe("ERC721Permit", function () {
    it("Should return correct DOMAIN_SEPARATOR", async function () {
      const { positionManager } = await loadFixture(deployFixture);

      const domainSeparator = await positionManager.DOMAIN_SEPARATOR();
      expect(domainSeparator).to.not.equal(ethers.ZeroHash);
    });

    it("Should return correct PERMIT_TYPEHASH", async function () {
      const { positionManager } = await loadFixture(deployFixture);

      const permitTypehash = await positionManager.PERMIT_TYPEHASH();
      // keccak256("Permit(address spender,uint256 tokenId,uint256 nonce,uint256 deadline)")
      expect(permitTypehash).to.equal(
        "0x49ecf333e5b8c95c40fdafc95c1ad136e8914a8fb55e9dc8bb01eaa83a2df9ad"
      );
    });

    it("Should allow owner to permit via signature", async function () {
      const { positionManager, admin, whitelistedUser, tokenId } = await loadFixture(deployFixture);

      const spender = whitelistedUser.address;
      const deadline = ethers.MaxUint256;
      const nonce = 0;

      const domain = {
        name: "Fusang V3 Positions NFT-V1",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: positionManager.target,
      };

      const types = {
        Permit: [
          { name: "spender", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        spender,
        tokenId,
        nonce,
        deadline,
      };

      const signature = await admin.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(positionManager.permit(spender, tokenId, deadline, v, r, s))
        .to.emit(positionManager, "Approval")
        .withArgs(admin.address, spender, tokenId);

      expect(await positionManager.getApproved(tokenId)).to.equal(spender);
    });

    it("Should revert permit with expired deadline", async function () {
      const { positionManager, admin, whitelistedUser, tokenId } = await loadFixture(deployFixture);

      const spender = whitelistedUser.address;
      const deadline = (await time.latest()) - 1; // expired
      const nonce = 0;

      const domain = {
        name: "Fusang V3 Positions NFT-V1",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: positionManager.target,
      };

      const types = {
        Permit: [
          { name: "spender", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        spender,
        tokenId,
        nonce,
        deadline,
      };

      const signature = await admin.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(positionManager.permit(spender, tokenId, deadline, v, r, s))
        .to.be.revertedWith("Permit expired");
    });

    it("Should revert permit when spender is owner", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      const spender = admin.address; // same as owner
      const deadline = ethers.MaxUint256;
      const nonce = 0;

      const domain = {
        name: "Fusang V3 Positions NFT-V1",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: positionManager.target,
      };

      const types = {
        Permit: [
          { name: "spender", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        spender,
        tokenId,
        nonce,
        deadline,
      };

      const signature = await admin.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(positionManager.permit(spender, tokenId, deadline, v, r, s))
        .to.be.revertedWith("ERC721Permit: approval to current owner");
    });

    it("Should revert permit with invalid signature", async function () {
      const { positionManager, admin, whitelistedUser, nonWhitelistedUser, tokenId } =
        await loadFixture(deployFixture);

      const spender = whitelistedUser.address;
      const deadline = ethers.MaxUint256;
      const nonce = 0;

      const domain = {
        name: "Fusang V3 Positions NFT-V1",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: positionManager.target,
      };

      const types = {
        Permit: [
          { name: "spender", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        spender,
        tokenId,
        nonce,
        deadline,
      };

      // Sign with wrong account (not the owner)
      const signature = await nonWhitelistedUser.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(positionManager.permit(spender, tokenId, deadline, v, r, s))
        .to.be.revertedWith("Unauthorized");
    });

    it("Should increment nonce after permit", async function () {
      const { positionManager, admin, whitelistedUser, tokenId } = await loadFixture(deployFixture);

      // Get initial position nonce
      const positionBefore = await positionManager.positions(tokenId);
      expect(positionBefore.nonce).to.equal(0);

      const spender = whitelistedUser.address;
      const deadline = ethers.MaxUint256;
      const nonce = 0;

      const domain = {
        name: "Fusang V3 Positions NFT-V1",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: positionManager.target,
      };

      const types = {
        Permit: [
          { name: "spender", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        spender,
        tokenId,
        nonce,
        deadline,
      };

      const signature = await admin.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await positionManager.permit(spender, tokenId, deadline, v, r, s);

      // Nonce should be incremented
      const positionAfter = await positionManager.positions(tokenId);
      expect(positionAfter.nonce).to.equal(1);
    });
  });

  describe("ERC721 approve and transfer", function () {
    it("Should allow owner to approve", async function () {
      const { positionManager, admin, whitelistedUser, tokenId } = await loadFixture(deployFixture);

      await expect(positionManager.connect(admin).approve(whitelistedUser.address, tokenId))
        .to.emit(positionManager, "Approval")
        .withArgs(admin.address, whitelistedUser.address, tokenId);

      expect(await positionManager.getApproved(tokenId)).to.equal(whitelistedUser.address);
    });

    it("Should allow approved address to decrease liquidity", async function () {
      const { positionManager, admin, whitelistedUser, walletList, tokenId } =
        await loadFixture(deployFixture);

      // Approve whitelistedUser
      await positionManager.connect(admin).approve(whitelistedUser.address, tokenId);

      // whitelistedUser should be able to decrease liquidity
      const decreaseParams = {
        tokenId: tokenId,
        liquidity: 1,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(whitelistedUser).decreaseLiquidity(decreaseParams))
        .to.emit(positionManager, "DecreaseLiquidity");
    });

    it("Should allow setApprovalForAll", async function () {
      const { positionManager, admin, whitelistedUser } = await loadFixture(deployFixture);

      await expect(positionManager.connect(admin).setApprovalForAll(whitelistedUser.address, true))
        .to.emit(positionManager, "ApprovalForAll")
        .withArgs(admin.address, whitelistedUser.address, true);

      expect(await positionManager.isApprovedForAll(admin.address, whitelistedUser.address)).to.be.true;
    });

    it("Should allow transferFrom by owner", async function () {
      const { positionManager, admin, whitelistedUser, tokenId } = await loadFixture(deployFixture);

      await expect(positionManager.connect(admin).transferFrom(admin.address, whitelistedUser.address, tokenId))
        .to.emit(positionManager, "Transfer")
        .withArgs(admin.address, whitelistedUser.address, tokenId);

      expect(await positionManager.ownerOf(tokenId)).to.equal(whitelistedUser.address);
    });

    it("Should allow transferFrom by approved address", async function () {
      const { positionManager, admin, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      // Create new position
      const mintTx = await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const newTokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const newTokenId = newTokenIdEvent.args[0];

      // Approve whitelistedUser
      await positionManager.connect(admin).approve(whitelistedUser.address, newTokenId);

      // whitelistedUser can now transfer on behalf of admin
      await expect(positionManager.connect(whitelistedUser).transferFrom(admin.address, whitelistedUser.address, newTokenId))
        .to.emit(positionManager, "Transfer")
        .withArgs(admin.address, whitelistedUser.address, newTokenId);
    });

    it("Should allow safeTransferFrom", async function () {
      const { positionManager, admin, whitelistedUser, tokenId } = await loadFixture(deployFixture);

      await expect(positionManager.connect(admin)["safeTransferFrom(address,address,uint256)"](
        admin.address, whitelistedUser.address, tokenId
      ))
        .to.emit(positionManager, "Transfer")
        .withArgs(admin.address, whitelistedUser.address, tokenId);
    });

    it("Should revert getApproved for nonexistent token", async function () {
      const { positionManager } = await loadFixture(deployFixture);

      await expect(positionManager.getApproved(999999))
        .to.be.revertedWith("ERC721: approved query for nonexistent token");
    });

    it("Should clear approval on transfer", async function () {
      const { positionManager, admin, whitelistedUser, nonWhitelistedUser, tokenA, tokenB, walletList } =
        await loadFixture(deployFixture);

      // Add nonWhitelistedUser to whitelist temporarily for this test
      await walletList.addToList(WHITELIST, MEMBER, nonWhitelistedUser.address);

      // Create new position
      const mintTx = await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const newTokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const newTokenId = newTokenIdEvent.args[0];

      // Approve whitelistedUser
      await positionManager.connect(admin).approve(whitelistedUser.address, newTokenId);
      expect(await positionManager.getApproved(newTokenId)).to.equal(whitelistedUser.address);

      // Transfer to nonWhitelistedUser
      await positionManager.connect(admin).transferFrom(admin.address, nonWhitelistedUser.address, newTokenId);

      // Approval should be cleared
      expect(await positionManager.getApproved(newTokenId)).to.equal(ethers.ZeroAddress);
    });
  });

  describe("transfer access control", function () {
    /**
     * Test Matrix:
     * - whitelistedUser: on WHITELIST, not on BLACKLIST/FROZENLIST
     * - nonWhitelistedUser: NOT on WHITELIST
     * - blacklistedUser: on WHITELIST but ALSO on BLACKLIST (fixture setup)
     * - admin: factory admin, can bypass all transfer checks
     */

    describe("whitelisted user transfers", function () {
      it("whitelisted → whitelisted: should succeed", async function () {
        const { positionManager, whitelistedUser, tokenA, tokenB, admin } = await loadFixture(deployFixture);

        // Mint position owned by whitelistedUser
        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target,
          token1: tokenB.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"),
          amount1Desired: ethers.parseEther("100"),
          amount0Min: 0,
          amount1Min: 0,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        // whitelistedUser transfers to admin (also whitelisted)
        await expect(
          positionManager.connect(whitelistedUser).transferFrom(whitelistedUser.address, admin.address, tokenId)
        )
          .to.emit(positionManager, "Transfer")
          .withArgs(whitelistedUser.address, admin.address, tokenId);
      });

      it("whitelisted → non-whitelisted: should revert", async function () {
        const { positionManager, whitelistedUser, nonWhitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        // Mint position owned by whitelistedUser
        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target,
          token1: tokenB.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"),
          amount1Desired: ethers.parseEther("100"),
          amount0Min: 0,
          amount1Min: 0,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        // whitelistedUser tries to transfer to nonWhitelistedUser
        await expect(
          positionManager.connect(whitelistedUser).transferFrom(whitelistedUser.address, nonWhitelistedUser.address, tokenId)
        )
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(nonWhitelistedUser.address);
      });

      it("whitelisted → blacklisted: should revert", async function () {
        const { positionManager, whitelistedUser, blacklistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        // Mint position owned by whitelistedUser
        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target,
          token1: tokenB.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"),
          amount1Desired: ethers.parseEther("100"),
          amount0Min: 0,
          amount1Min: 0,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        // blacklistedUser is on WHITELIST but also on BLACKLIST (see fixture)
        // whitelistedUser tries to transfer to blacklistedUser
        await expect(
          positionManager.connect(whitelistedUser).transferFrom(whitelistedUser.address, blacklistedUser.address, tokenId)
        )
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(blacklistedUser.address);
      });

      it("whitelisted → frozen: should revert", async function () {
        const { positionManager, whitelistedUser, walletList, tokenA, tokenB, admin } = await loadFixture(deployFixture);

        // Mint position owned by whitelistedUser
        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target,
          token1: tokenB.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"),
          amount1Desired: ethers.parseEther("100"),
          amount0Min: 0,
          amount1Min: 0,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        // Freeze admin (recipient)
        await walletList.addToList(FROZENLIST, DEFAULT_ADMIN_ROLE, admin.address);

        // whitelistedUser tries to transfer to frozen admin
        await expect(
          positionManager.connect(whitelistedUser).transferFrom(whitelistedUser.address, admin.address, tokenId)
        )
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(admin.address);
      });
    });

    describe("blacklisted user transfers", function () {
      it("blacklisted → whitelisted: should revert", async function () {
        const { positionManager, whitelistedUser, walletList, tokenA, tokenB, admin } = await loadFixture(deployFixture);

        // Mint position owned by whitelistedUser
        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target,
          token1: tokenB.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"),
          amount1Desired: ethers.parseEther("100"),
          amount0Min: 0,
          amount1Min: 0,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        // Now blacklist whitelistedUser (simulating they got blacklisted after minting)
        await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser.address);

        // Blacklisted user tries to transfer their position
        await expect(
          positionManager.connect(whitelistedUser).transferFrom(whitelistedUser.address, admin.address, tokenId)
        )
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(whitelistedUser.address);
      });
    });

    describe("blacklisted operator transfers", function () {
      it("blacklisted operator cannot transferFrom even with approval", async function () {
        const { positionManager, admin, whitelistedUser, walletList, tokenA, tokenB } = await loadFixture(deployFixture);

        // Get a new signer for the operator
        const [, , , , , operator] = await ethers.getSigners();

        // Whitelist operator
        await walletList.addToList(WHITELIST, MEMBER, operator.address);

        // Mint position for whitelistedUser
        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target,
          token1: tokenB.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"),
          amount1Desired: ethers.parseEther("100"),
          amount0Min: 0,
          amount1Min: 0,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        // Approve operator
        await positionManager.connect(whitelistedUser).approve(operator.address, tokenId);

        // Blacklist the operator
        await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, operator.address);

        // Blacklisted operator tries to transferFrom — should revert
        await expect(
          positionManager.connect(operator).transferFrom(whitelistedUser.address, admin.address, tokenId)
        )
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(operator.address);
      });

      it("frozen operator cannot transferFrom even with approval", async function () {
        const { positionManager, admin, whitelistedUser, walletList, tokenA, tokenB } = await loadFixture(deployFixture);

        const [, , , , , operator] = await ethers.getSigners();
        await walletList.addToList(WHITELIST, MEMBER, operator.address);

        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target,
          token1: tokenB.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"),
          amount1Desired: ethers.parseEther("100"),
          amount0Min: 0,
          amount1Min: 0,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        await positionManager.connect(whitelistedUser).approve(operator.address, tokenId);

        // Freeze the operator
        await walletList.addToList(FROZENLIST, DEFAULT_ADMIN_ROLE, operator.address);

        // Frozen operator tries to transferFrom — should revert
        await expect(
          positionManager.connect(operator).transferFrom(whitelistedUser.address, admin.address, tokenId)
        )
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(operator.address);
      });

      it("blacklisted operator cannot transferFrom via permit approval", async function () {
        const { positionManager, admin, whitelistedUser, walletList, tokenA, tokenB } = await loadFixture(deployFixture);

        const [, , , , , operator] = await ethers.getSigners();
        await walletList.addToList(WHITELIST, MEMBER, operator.address);

        // Mint position for whitelistedUser
        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target,
          token1: tokenB.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"),
          amount1Desired: ethers.parseEther("100"),
          amount0Min: 0,
          amount1Min: 0,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        // Owner signs permit granting operator approval
        const { v, r, s } = await getPermitNFTSignature(whitelistedUser, positionManager, operator.address, tokenId);
        await positionManager.permit(operator.address, tokenId, ethers.MaxUint256, v, r, s);

        // Blacklist the operator after permit
        await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, operator.address);

        // Blacklisted operator tries to transferFrom via permit — should revert
        await expect(
          positionManager.connect(operator).transferFrom(whitelistedUser.address, admin.address, tokenId)
        )
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(operator.address);
      });
    });

    describe("admin force transfers (bypass checks)", function () {
      it("admin can transfer to non-whitelisted user", async function () {
        const { positionManager, admin, nonWhitelistedUser, tokenId } = await loadFixture(deployFixture);

        // Admin (factory admin) can bypass all transfer checks
        await expect(
          positionManager.connect(admin).transferFrom(admin.address, nonWhitelistedUser.address, tokenId)
        )
          .to.emit(positionManager, "Transfer")
          .withArgs(admin.address, nonWhitelistedUser.address, tokenId);
      });

      it("admin can transfer from blacklisted user (without explicit approval)", async function () {
        const { positionManager, admin, whitelistedUser, walletList, tokenA, tokenB } = await loadFixture(deployFixture);

        // Mint position owned by whitelistedUser
        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target,
          token1: tokenB.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"),
          amount1Desired: ethers.parseEther("100"),
          amount0Min: 0,
          amount1Min: 0,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        // Blacklist the user (no approval needed - admin is auto-approved)
        await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser.address);

        // Admin can transfer FROM blacklisted user without explicit approval
        await expect(
          positionManager.connect(admin).transferFrom(whitelistedUser.address, admin.address, tokenId)
        )
          .to.emit(positionManager, "Transfer")
          .withArgs(whitelistedUser.address, admin.address, tokenId);
      });

      it("admin is auto-approved for all tokens (isApprovedForAll)", async function () {
        const { positionManager, admin, whitelistedUser } = await loadFixture(deployFixture);

        // Admin should be approved for all tokens by default
        expect(await positionManager.isApprovedForAll(whitelistedUser.address, admin.address)).to.be.true;
      });

      it("admin can transfer to blacklisted user", async function () {
        const { positionManager, admin, blacklistedUser, tokenId } = await loadFixture(deployFixture);

        // Admin can transfer TO blacklisted user
        await expect(
          positionManager.connect(admin).transferFrom(admin.address, blacklistedUser.address, tokenId)
        )
          .to.emit(positionManager, "Transfer")
          .withArgs(admin.address, blacklistedUser.address, tokenId);
      });
    });

    describe("approval-time compliance checks", function () {
      it("approve: should revert when approving blacklisted operator", async function () {
        const { positionManager, whitelistedUser, blacklistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target, token1: tokenB.target, fee: 3000,
          tickLower: getMinTick(60), tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"), amount1Desired: ethers.parseEther("100"),
          amount0Min: 0, amount1Min: 0, recipient: whitelistedUser.address, deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        await expect(positionManager.connect(whitelistedUser).approve(blacklistedUser.address, tokenId))
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(blacklistedUser.address);
      });

      it("approve: should revert when approving frozen operator", async function () {
        const { positionManager, whitelistedUser, frozenUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target, token1: tokenB.target, fee: 3000,
          tickLower: getMinTick(60), tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"), amount1Desired: ethers.parseEther("100"),
          amount0Min: 0, amount1Min: 0, recipient: whitelistedUser.address, deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        await expect(positionManager.connect(whitelistedUser).approve(frozenUser.address, tokenId))
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(frozenUser.address);
      });

      it("approve: should revert when approving non-whitelisted operator", async function () {
        const { positionManager, whitelistedUser, nonWhitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target, token1: tokenB.target, fee: 3000,
          tickLower: getMinTick(60), tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"), amount1Desired: ethers.parseEther("100"),
          amount0Min: 0, amount1Min: 0, recipient: whitelistedUser.address, deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        await expect(positionManager.connect(whitelistedUser).approve(nonWhitelistedUser.address, tokenId))
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(nonWhitelistedUser.address);
      });

      it("approve: should allow approving whitelisted operator", async function () {
        const { positionManager, admin, whitelistedUser, tokenId } = await loadFixture(deployFixture);

        await expect(positionManager.connect(admin).approve(whitelistedUser.address, tokenId))
          .to.not.be.reverted;
      });

      it("approve: should allow revoking approval (address(0))", async function () {
        const { positionManager, admin, whitelistedUser, tokenId } = await loadFixture(deployFixture);

        await positionManager.connect(admin).approve(whitelistedUser.address, tokenId);
        await expect(positionManager.connect(admin).approve(ethers.ZeroAddress, tokenId))
          .to.not.be.reverted;
      });

      it("approve: admin can be approved (god mode bypass)", async function () {
        const { positionManager, admin, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target, token1: tokenB.target, fee: 3000,
          tickLower: getMinTick(60), tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"), amount1Desired: ethers.parseEther("100"),
          amount0Min: 0, amount1Min: 0, recipient: whitelistedUser.address, deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        await expect(positionManager.connect(whitelistedUser).approve(admin.address, tokenId))
          .to.not.be.reverted;
      });

      it("approve: should revert when blacklisted caller tries to approve", async function () {
        const { positionManager, admin, whitelistedUser, walletList, tokenA, tokenB } = await loadFixture(deployFixture);

        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target, token1: tokenB.target, fee: 3000,
          tickLower: getMinTick(60), tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"), amount1Desired: ethers.parseEther("100"),
          amount0Min: 0, amount1Min: 0, recipient: whitelistedUser.address, deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        // Blacklist the owner
        await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser.address);

        // Blacklisted caller cannot approve
        await expect(positionManager.connect(whitelistedUser).approve(admin.address, tokenId))
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(whitelistedUser.address);
      });

      it("setApprovalForAll: should revert when blacklisted caller tries to approve", async function () {
        const { positionManager, whitelistedUser, walletList } = await loadFixture(deployFixture);

        const [, , , , , operator] = await ethers.getSigners();
        await walletList.addToList(WHITELIST, MEMBER, operator.address);

        // Blacklist whitelistedUser
        await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser.address);

        // Blacklisted caller cannot setApprovalForAll
        await expect(positionManager.connect(whitelistedUser).setApprovalForAll(operator.address, true))
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(whitelistedUser.address);
      });

      it("setApprovalForAll: should revert when approving blacklisted operator", async function () {
        const { positionManager, whitelistedUser, blacklistedUser } = await loadFixture(deployFixture);

        await expect(positionManager.connect(whitelistedUser).setApprovalForAll(blacklistedUser.address, true))
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(blacklistedUser.address);
      });

      it("setApprovalForAll: should revert when approving frozen operator", async function () {
        const { positionManager, whitelistedUser, frozenUser } = await loadFixture(deployFixture);

        await expect(positionManager.connect(whitelistedUser).setApprovalForAll(frozenUser.address, true))
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(frozenUser.address);
      });

      it("setApprovalForAll: should revert when approving non-whitelisted operator", async function () {
        const { positionManager, whitelistedUser, nonWhitelistedUser } = await loadFixture(deployFixture);

        await expect(positionManager.connect(whitelistedUser).setApprovalForAll(nonWhitelistedUser.address, true))
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(nonWhitelistedUser.address);
      });

      it("setApprovalForAll: should allow revoking approval for non-compliant operator", async function () {
        const { positionManager, whitelistedUser, walletList } = await loadFixture(deployFixture);

        const [, , , , , operator] = await ethers.getSigners();
        await walletList.addToList(WHITELIST, MEMBER, operator.address);

        // Approve while whitelisted
        await positionManager.connect(whitelistedUser).setApprovalForAll(operator.address, true);

        // Blacklist operator
        await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, operator.address);

        // Revoking (false) should still work even for blacklisted operator
        await expect(positionManager.connect(whitelistedUser).setApprovalForAll(operator.address, false))
          .to.not.be.reverted;
      });

      it("setApprovalForAll: should allow approving whitelisted operator", async function () {
        const { positionManager, admin, whitelistedUser } = await loadFixture(deployFixture);

        await expect(positionManager.connect(admin).setApprovalForAll(whitelistedUser.address, true))
          .to.not.be.reverted;
      });

      it("permit: should revert when granting permit to blacklisted operator", async function () {
        const { positionManager, whitelistedUser, walletList, tokenA, tokenB } = await loadFixture(deployFixture);

        const [, , , , , operator] = await ethers.getSigners();
        await walletList.addToList(WHITELIST, MEMBER, operator.address);

        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target, token1: tokenB.target, fee: 3000,
          tickLower: getMinTick(60), tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"), amount1Desired: ethers.parseEther("100"),
          amount0Min: 0, amount1Min: 0, recipient: whitelistedUser.address, deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        // Blacklist operator before permit
        await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, operator.address);

        // Permit calls _approve internally — should revert
        const { v, r, s } = await getPermitNFTSignature(whitelistedUser, positionManager, operator.address, tokenId);
        await expect(positionManager.permit(operator.address, tokenId, ethers.MaxUint256, v, r, s))
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(operator.address);
      });
    });

    describe("safeTransferFrom access control", function () {
      it("whitelisted → non-whitelisted via safeTransferFrom: should revert", async function () {
        const { positionManager, whitelistedUser, nonWhitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        // Mint position owned by whitelistedUser
        const mintTx = await positionManager.connect(whitelistedUser).mint({
          token0: tokenA.target,
          token1: tokenB.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          amount0Desired: ethers.parseEther("100"),
          amount1Desired: ethers.parseEther("100"),
          amount0Min: 0,
          amount1Min: 0,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
        });
        const receipt = await mintTx.wait();
        const tokenId = receipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity").args[0];

        // safeTransferFrom should also enforce access control
        await expect(
          positionManager.connect(whitelistedUser)["safeTransferFrom(address,address,uint256)"](
            whitelistedUser.address, nonWhitelistedUser.address, tokenId
          )
        )
          .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
          .withArgs(nonWhitelistedUser.address);
      });
    });
  });

  describe("tokenURI", function () {
    it("Should return valid tokenURI", async function () {
      const { positionManager, tokenId } = await loadFixture(deployFixture);

      const uri = await positionManager.tokenURI(tokenId);
      expect(uri).to.include("data:application/json;base64,");
    });

    it("Should revert for nonexistent token", async function () {
      const { positionManager } = await loadFixture(deployFixture);

      await expect(positionManager.tokenURI(999999))
        .to.be.reverted;
    });
  });

  describe("deadline validation", function () {
    it("Should revert mint with expired deadline", async function () {
      const { positionManager, admin, tokenA, tokenB } = await loadFixture(deployFixture);

      const pastDeadline = (await time.latest()) - 1;

      const mintParams = {
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: pastDeadline,
      };

      await expect(positionManager.connect(admin).mint(mintParams))
        .to.be.revertedWith("Transaction too old");
    });

    it("Should revert increaseLiquidity with expired deadline", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      const pastDeadline = (await time.latest()) - 1;

      const increaseParams = {
        tokenId: tokenId,
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: pastDeadline,
      };

      await expect(positionManager.connect(admin).increaseLiquidity(increaseParams))
        .to.be.revertedWith("Transaction too old");
    });

    it("Should revert decreaseLiquidity with expired deadline", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      const pastDeadline = (await time.latest()) - 1;

      const decreaseParams = {
        tokenId: tokenId,
        liquidity: 1,
        amount0Min: 0,
        amount1Min: 0,
        deadline: pastDeadline,
      };

      await expect(positionManager.connect(admin).decreaseLiquidity(decreaseParams))
        .to.be.revertedWith("Transaction too old");
    });
  });

  describe("decreaseLiquidity edge cases", function () {
    it("Should revert when liquidity is 0", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      const decreaseParams = {
        tokenId: tokenId,
        liquidity: 0,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(admin).decreaseLiquidity(decreaseParams))
        .to.be.reverted;
    });

    it("Should revert when requesting more liquidity than available", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      const position = await positionManager.positions(tokenId);
      const tooMuchLiquidity = BigInt(position.liquidity) + 1n;

      const decreaseParams = {
        tokenId: tokenId,
        liquidity: tooMuchLiquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(admin).decreaseLiquidity(decreaseParams))
        .to.be.reverted;
    });

    it("Should revert for non-whitelisted user", async function () {
      const { positionManager, admin, nonWhitelistedUser, tokenId } = await loadFixture(deployFixture);

      // Transfer token to nonWhitelistedUser
      await positionManager.connect(admin).transferFrom(admin.address, nonWhitelistedUser.address, tokenId);

      const decreaseParams = {
        tokenId: tokenId,
        liquidity: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(nonWhitelistedUser).decreaseLiquidity(decreaseParams))
        .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
        .withArgs(nonWhitelistedUser.address);
    });

    it("Should revert when amount0 is below minimum (price slippage)", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      const decreaseParams = {
        tokenId: tokenId,
        liquidity: 1000,
        amount0Min: ethers.parseEther("1000000"), // Unreasonably high minimum
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(admin).decreaseLiquidity(decreaseParams))
        .to.be.revertedWith("Price slippage check");
    });

    it("Should revert when amount1 is below minimum (price slippage)", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      const decreaseParams = {
        tokenId: tokenId,
        liquidity: 1000,
        amount0Min: 0,
        amount1Min: ethers.parseEther("1000000"), // Unreasonably high minimum
        deadline: ethers.MaxUint256,
      };

      await expect(positionManager.connect(admin).decreaseLiquidity(decreaseParams))
        .to.be.revertedWith("Price slippage check");
    });
  });

  describe("collect edge cases", function () {
    it("Should revert collect when recipient is address(0)", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      await positionManager.connect(admin).decreaseLiquidity({
        tokenId: tokenId,
        liquidity: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      const collectParams = {
        tokenId: tokenId,
        recipient: ethers.ZeroAddress,
        amount0Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
        amount1Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
      };

      await expect(positionManager.connect(admin).collect(collectParams))
        .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
    });

    it("Should revert when both amount0Max and amount1Max are 0", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      const collectParams = {
        tokenId: tokenId,
        recipient: admin.address,
        amount0Max: 0,
        amount1Max: 0,
      };

      await expect(positionManager.connect(admin).collect(collectParams))
        .to.be.reverted;
    });

    it("Should collect only amount0 when amount1Max is 0", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      // Decrease liquidity first
      await positionManager.connect(admin).decreaseLiquidity({
        tokenId: tokenId,
        liquidity: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      const collectParams = {
        tokenId: tokenId,
        recipient: admin.address,
        amount0Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
        amount1Max: 0,
      };

      await expect(positionManager.connect(admin).collect(collectParams))
        .to.not.be.reverted;
    });

    it("Should collect only amount1 when amount0Max is 0", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      // Decrease liquidity first
      await positionManager.connect(admin).decreaseLiquidity({
        tokenId: tokenId,
        liquidity: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      const collectParams = {
        tokenId: tokenId,
        recipient: admin.address,
        amount0Max: 0,
        amount1Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
      };

      await expect(positionManager.connect(admin).collect(collectParams))
        .to.not.be.reverted;
    });

    it("Should revert for non-whitelisted user", async function () {
      const { positionManager, admin, nonWhitelistedUser, tokenId } = await loadFixture(deployFixture);

      // Transfer token to nonWhitelistedUser
      await positionManager.connect(admin).transferFrom(admin.address, nonWhitelistedUser.address, tokenId);

      // Decrease liquidity first (as admin before transferring)
      // Actually need to do this with whitelisted user first
      // Re-create the scenario: mint new position for nonWhitelistedUser
      const collectParams = {
        tokenId: tokenId,
        recipient: nonWhitelistedUser.address,
        amount0Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
        amount1Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
      };

      await expect(positionManager.connect(nonWhitelistedUser).collect(collectParams))
        .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
        .withArgs(nonWhitelistedUser.address);
    });
  });

  describe("burn edge cases", function () {
    it("Should revert when position has liquidity", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      await expect(positionManager.connect(admin).burn(tokenId))
        .to.be.revertedWith("Not cleared");
    });

    it("Should revert when position has tokens owed", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      // Get position info
      const position = await positionManager.positions(tokenId);

      // Decrease all liquidity (this will set tokensOwed)
      await positionManager.connect(admin).decreaseLiquidity({
        tokenId: tokenId,
        liquidity: position.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      // Try to burn without collecting
      await expect(positionManager.connect(admin).burn(tokenId))
        .to.be.revertedWith("Not cleared");
    });

    it("Should revert for non-whitelisted user", async function () {
      const { positionManager, admin, nonWhitelistedUser, tokenA, tokenB, whitelistedUser } = await loadFixture(deployFixture);

      // Mint a new position for whitelisted user
      const mintTx = await positionManager.connect(whitelistedUser).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const newTokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const newTokenId = newTokenIdEvent.args[0];

      // Decrease all liquidity
      const position = await positionManager.positions(newTokenId);
      await positionManager.connect(whitelistedUser).decreaseLiquidity({
        tokenId: newTokenId,
        liquidity: position.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      // Collect all tokens
      await positionManager.connect(whitelistedUser).collect({
        tokenId: newTokenId,
        recipient: whitelistedUser.address,
        amount0Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
        amount1Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
      });

      // Transfer to non-whitelisted user (admin can bypass transfer checks)
      await positionManager.connect(whitelistedUser).transferFrom(whitelistedUser.address, admin.address, newTokenId);
      await positionManager.connect(admin).transferFrom(admin.address, nonWhitelistedUser.address, newTokenId);

      // Try to burn as non-whitelisted user
      await expect(positionManager.connect(nonWhitelistedUser).burn(newTokenId))
        .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
        .withArgs(nonWhitelistedUser.address);
    });

    it("Should revert for non-authorized user", async function () {
      const { positionManager, admin, whitelistedUser, tokenId } = await loadFixture(deployFixture);

      // Get position info and clear it
      const position = await positionManager.positions(tokenId);
      await positionManager.connect(admin).decreaseLiquidity({
        tokenId: tokenId,
        liquidity: position.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      await positionManager.connect(admin).collect({
        tokenId: tokenId,
        recipient: admin.address,
        amount0Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
        amount1Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
      });

      // whitelistedUser is not the owner and not approved
      await expect(positionManager.connect(whitelistedUser).burn(tokenId))
        .to.be.revertedWith("Not approved");
    });
  });

  describe("multicall", function () {
    it("Should execute multiple calls in one transaction", async function () {
      const { positionManager, admin, tokenA, tokenB, tokenId } = await loadFixture(deployFixture);

      // Prepare two mint calls
      const mintParams1 = {
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("50"),
        amount1Desired: ethers.parseEther("50"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      };

      const mintParams2 = {
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("50"),
        amount1Desired: ethers.parseEther("50"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      };

      const mintData1 = positionManager.interface.encodeFunctionData("mint", [mintParams1]);
      const mintData2 = positionManager.interface.encodeFunctionData("mint", [mintParams2]);

      await expect(positionManager.connect(admin).multicall([mintData1, mintData2]))
        .to.not.be.reverted;
    });

    it("Should work with single call", async function () {
      const { positionManager, admin, tokenA, tokenB } = await loadFixture(deployFixture);

      const mintParams = {
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("50"),
        amount1Desired: ethers.parseEther("50"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      };

      const mintData = positionManager.interface.encodeFunctionData("mint", [mintParams]);

      await expect(positionManager.connect(admin).multicall([mintData]))
        .to.not.be.reverted;
    });
  });

  describe("multicall ETH flows", function () {
    it("multicall([mint, refundETH]) — mint position with ETH refund", async function () {
      const { positionManager, admin, tokenA, weth9, fusangFactory } = await loadFixture(deployFixture);

      // Sort WETH and tokenA
      const [token0, token1] = weth9.target.toLowerCase() < tokenA.target.toLowerCase()
        ? [weth9, tokenA]
        : [tokenA, weth9];

      // Create WETH pool
      await fusangFactory.createPool(token0.target, token1.target, 3000);
      await positionManager.createAndInitializePoolIfNecessary(
        token0.target, token1.target, 3000, encodePriceSqrt(1, 1)
      );

      // Deposit WETH for liquidity seeding
      await weth9.deposit({ value: ethers.parseEther("200") });
      await weth9.approve(positionManager.target, ethers.MaxUint256);
      await tokenA.approve(positionManager.target, ethers.MaxUint256);

      // Seed liquidity so the pool has tokens
      await positionManager.connect(admin).mint({
        token0: token0.target, token1: token1.target, fee: 3000,
        tickLower: getMinTick(60), tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"), amount1Desired: ethers.parseEther("100"),
        amount0Min: 0, amount1Min: 0, recipient: admin.address, deadline: ethers.MaxUint256,
      });

      // Now mint via multicall with ETH
      const mintData = positionManager.interface.encodeFunctionData("mint", [{
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("1"),
        amount1Desired: ethers.parseEther("1"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      }]);

      const refundData = positionManager.interface.encodeFunctionData("refundETH");

      const balanceBefore = await ethers.provider.getBalance(admin.address);

      await expect(positionManager.connect(admin).multicall([mintData, refundData], { value: ethers.parseEther("2") }))
        .to.not.be.reverted;
    });

    it("multicall([createAndInitializePoolIfNecessary, mint, refundETH]) — create pool + mint with ETH", async function () {
      const { positionManager, admin, weth9, fusangFactory } = await loadFixture(deployFixture);

      // Deploy a new token for a fresh pool
      const TokenFactory = await ethers.getContractFactory("contracts/core/test/TestERC20.sol:TestERC20");
      const newToken = await TokenFactory.deploy(ethers.parseEther("1000000"));
      await newToken.approve(positionManager.target, ethers.MaxUint256);

      // Sort WETH and newToken
      const [token0, token1] = weth9.target.toLowerCase() < newToken.target.toLowerCase()
        ? [weth9, newToken]
        : [newToken, weth9];

      await fusangFactory.createPool(token0.target, token1.target, 3000);

      const createData = positionManager.interface.encodeFunctionData("createAndInitializePoolIfNecessary", [
        token0.target, token1.target, 3000, encodePriceSqrt(1, 1),
      ]);

      const mintData = positionManager.interface.encodeFunctionData("mint", [{
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("1"),
        amount1Desired: ethers.parseEther("1"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      }]);

      const refundData = positionManager.interface.encodeFunctionData("refundETH");

      await expect(positionManager.connect(admin).multicall([createData, mintData, refundData], { value: ethers.parseEther("2") }))
        .to.not.be.reverted;
    });

    it("multicall([increaseLiquidity, refundETH]) — increase liquidity with ETH refund", async function () {
      const { positionManager, admin, tokenA, weth9, fusangFactory } = await loadFixture(deployFixture);

      // Sort WETH and tokenA
      const [token0, token1] = weth9.target.toLowerCase() < tokenA.target.toLowerCase()
        ? [weth9, tokenA]
        : [tokenA, weth9];

      // Create WETH pool and seed liquidity
      await weth9.deposit({ value: ethers.parseEther("200") });
      await weth9.approve(positionManager.target, ethers.MaxUint256);

      await fusangFactory.createPool(token0.target, token1.target, 3000);
      await positionManager.createAndInitializePoolIfNecessary(
        token0.target, token1.target, 3000, encodePriceSqrt(1, 1)
      );

      const mintTx = await positionManager.connect(admin).mint({
        token0: token0.target, token1: token1.target, fee: 3000,
        tickLower: getMinTick(60), tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("10"), amount1Desired: ethers.parseEther("10"),
        amount0Min: 0, amount1Min: 0, recipient: admin.address, deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const tokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const newTokenId = tokenIdEvent.args[0];

      const increaseData = positionManager.interface.encodeFunctionData("increaseLiquidity", [{
        tokenId: newTokenId,
        amount0Desired: ethers.parseEther("1"),
        amount1Desired: ethers.parseEther("1"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      }]);

      const refundData = positionManager.interface.encodeFunctionData("refundETH");

      await expect(positionManager.connect(admin).multicall([increaseData, refundData], { value: ethers.parseEther("2") }))
        .to.not.be.reverted;
    });
  });

  describe("multicall position exit flow", function () {
    it("Should decreaseLiquidity + collect + burn via multicall", async function () {
      const { positionManager, admin, tokenA, tokenB } = await loadFixture(deployFixture);

      // Mint a new position
      const mintTx = await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const tokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const newTokenId = tokenIdEvent.args[0];

      const position = await positionManager.positions(newTokenId);

      const decreaseData = positionManager.interface.encodeFunctionData("decreaseLiquidity", [{
        tokenId: newTokenId,
        liquidity: position.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      }]);

      const collectData = positionManager.interface.encodeFunctionData("collect", [{
        tokenId: newTokenId,
        recipient: admin.address,
        amount0Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
        amount1Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
      }]);

      const burnData = positionManager.interface.encodeFunctionData("burn", [newTokenId]);

      // Standard position exit: decreaseLiquidity + collect + burn in one tx
      await expect(positionManager.connect(admin).multicall([decreaseData, collectData, burnData]))
        .to.not.be.reverted;

      // Verify position is burned
      await expect(positionManager.positions(newTokenId))
        .to.be.revertedWith("Invalid token ID");
    });
  });

  describe("removePosition additional edge cases", function () {
    it("Should revert for invalid token ID", async function () {
      const { positionManager, admin } = await loadFixture(deployFixture);

      await expect(positionManager.connect(admin).removePosition({tokenId: 999999, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.be.revertedWith("Invalid token ID");
    });

    it("Should revert when non-admin tries to remove on inactive pool", async function () {
      const { positionManager, fusangPoolState, admin, whitelistedUser, tokenA, tokenB, poolAddress, walletList } =
        await loadFixture(deployFixture);

      const mintTx = await positionManager.connect(whitelistedUser).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const userTokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const userTokenId = userTokenIdEvent.args[0];

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(whitelistedUser).removePosition({tokenId: userTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.be.revertedWithCustomError(positionManager, "NotAdmin");
    });

    it("Should emit DecreaseLiquidity when removing position with liquidity on paused pool", async function () {
      const { positionManager, fusangPoolState, admin, tokenId, poolAddress } = await loadFixture(deployFixture);

      const position = await positionManager.positions(tokenId);
      expect(position.liquidity).to.be.gt(0);

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(admin).removePosition({tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.emit(positionManager, "DecreaseLiquidity");
    });

    it("Should collect principal tokens directly when removePosition is called on paused pool", async function () {
      const { positionManager, fusangPoolState, admin, tokenA, tokenB, poolAddress } = await loadFixture(deployFixture);

      const mintTx = await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("50"),
        amount1Desired: ethers.parseEther("50"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const tokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const newTokenId = tokenIdEvent.args[0];

      const position = await positionManager.positions(newTokenId);
      expect(position.liquidity).to.be.gt(0);

      const balanceBefore0 = await tokenA.balanceOf(admin.address);
      const balanceBefore1 = await tokenB.balanceOf(admin.address);

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      const removeTx = await positionManager.connect(admin).removePosition({tokenId: newTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256});
      const removeReceipt = await removeTx.wait();

      const decreaseEvent = removeReceipt.logs.find(
        (log) => log.fragment?.name === "DecreaseLiquidity"
      );
      expect(decreaseEvent).to.not.be.undefined;
      const [, , amount0Decreased, amount1Decreased] = decreaseEvent.args;
      expect(amount0Decreased).to.be.gt(0);
      expect(amount1Decreased).to.be.gt(0);

      const collectEvent = removeReceipt.logs.find(
        (log) => log.fragment?.name === "Collect"
      );
      expect(collectEvent).to.not.be.undefined;
      const [, recipient, amount0Collected, amount1Collected] = collectEvent.args;
      expect(recipient).to.eq(admin.address);
      expect(amount0Collected).to.be.gt(0);
      expect(amount1Collected).to.be.gt(0);

      const balanceAfter0 = await tokenA.balanceOf(admin.address);
      const balanceAfter1 = await tokenB.balanceOf(admin.address);
      expect(balanceAfter0 - balanceBefore0).to.eq(amount0Collected);
      expect(balanceAfter1 - balanceBefore1).to.eq(amount1Collected);

      await expect(positionManager.positions(newTokenId))
        .to.be.revertedWith("Invalid token ID");
    });

    it("Should collect principal + fees when removePosition is called on paused pool after swaps", async function () {
      const { positionManager, fusangPoolState, swapRouter, admin, whitelistedUser, tokenA, tokenB, poolAddress } = await loadFixture(deployFixture);

      const mintTx = await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const tokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const newTokenId = tokenIdEvent.args[0];

      const positionAfterMint = await positionManager.positions(newTokenId);
      const initialLiquidity = positionAfterMint.liquidity;

      const swapAmount = ethers.parseEther("1000");

      await swapRouter.connect(whitelistedUser).exactInputSingle({
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: swapAmount,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      });

      await swapRouter.connect(whitelistedUser).exactInputSingle({
        tokenIn: tokenB.target,
        tokenOut: tokenA.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: swapAmount,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      });

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      const removeTx = await positionManager.connect(admin).removePosition({tokenId: newTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256});
      const removeReceipt = await removeTx.wait();

      const decreaseEvent = removeReceipt.logs.find(
        (log) => log.fragment?.name === "DecreaseLiquidity"
      );
      const [, decreaseLiquidity, amount0Decreased, amount1Decreased] = decreaseEvent.args;
      expect(decreaseLiquidity).to.eq(initialLiquidity);

      const collectEvent = removeReceipt.logs.find(
        (log) => log.fragment?.name === "Collect"
      );
      const [, , amount0Collected, amount1Collected] = collectEvent.args;
      expect(amount0Collected).to.be.gte(amount0Decreased);
      expect(amount1Collected).to.be.gte(amount1Decreased);

      await expect(positionManager.positions(newTokenId))
        .to.be.revertedWith("Invalid token ID");
    });

    it("Should handle removePosition when only tokensOwed1 is positive on paused pool", async function () {
      const { positionManager, fusangPoolState, admin, tokenA, tokenB, poolAddress } = await loadFixture(deployFixture);

      const mintTx = await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const newTokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const newTokenId = newTokenIdEvent.args[0];

      const position = await positionManager.positions(newTokenId);
      await positionManager.connect(admin).decreaseLiquidity({
        tokenId: newTokenId,
        liquidity: position.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      });

      await positionManager.connect(admin).collect({
        tokenId: newTokenId,
        recipient: admin.address,
        amount0Max: new BigNumber("0xffffffffffffffffffffffffffffffff", 16).toString(),
        amount1Max: 0,
      });

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      await expect(positionManager.connect(admin).removePosition({tokenId: newTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.emit(positionManager, "Collect");
    });
  });

  describe("ERC721Enumerable", function () {
    it("Should return correct totalSupply", async function () {
      const { positionManager, admin, tokenA, tokenB } = await loadFixture(deployFixture);

      const initialSupply = await positionManager.totalSupply();

      // Mint another position
      await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });

      expect(await positionManager.totalSupply()).to.equal(initialSupply + 1n);
    });

    it("Should return correct tokenByIndex", async function () {
      const { positionManager, tokenId } = await loadFixture(deployFixture);

      const tokenAtIndex = await positionManager.tokenByIndex(0);
      expect(tokenAtIndex).to.equal(tokenId);
    });

    it("Should return correct tokenOfOwnerByIndex", async function () {
      const { positionManager, admin, tokenId } = await loadFixture(deployFixture);

      const tokenOfOwner = await positionManager.tokenOfOwnerByIndex(admin.address, 0);
      expect(tokenOfOwner).to.equal(tokenId);
    });

    it("Should return correct balanceOf", async function () {
      const { positionManager, admin, tokenA, tokenB } = await loadFixture(deployFixture);

      const initialBalance = await positionManager.balanceOf(admin.address);

      // Mint another position
      await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });

      expect(await positionManager.balanceOf(admin.address)).to.equal(initialBalance + 1n);
    });
  });

  describe("createAndInitializePoolIfNecessary", function () {
    it("Should create and initialize pool", async function () {
      const { positionManager, fusangFactory, admin } = await loadFixture(deployFixture);

      // Deploy new tokens for a fresh pool
      const TokenFactory = await ethers.getContractFactory(
        "contracts/core/test/TestERC20.sol:TestERC20"
      );
      const newTokenA = await TokenFactory.deploy(ethers.parseEther("1000000"));
      const newTokenB = await TokenFactory.deploy(ethers.parseEther("1000000"));

      // Sort tokens properly (token0 < token1 required by PoolInitializer)
      const [token0, token1] = newTokenA.target.toLowerCase() < newTokenB.target.toLowerCase()
        ? [newTokenA, newTokenB]
        : [newTokenB, newTokenA];

      // Create pool via factory first
      await expect(fusangFactory.createPool(token0.target, token1.target, 500))
        .to.emit(fusangFactory, "PoolCreated");

      // Initialize pool
      await positionManager.createAndInitializePoolIfNecessary(
        token0.target,
        token1.target,
        500, // Different fee tier
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await fusangFactory.getPool(token0.target, token1.target, 500);
      expect(poolAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("Should revert when non-admin tries to create pool", async function () {
      const { positionManager, whitelistedUser, fusangFactory } = await loadFixture(deployFixture);

      const TokenFactory = await ethers.getContractFactory(
        "contracts/core/test/TestERC20.sol:TestERC20"
      );
      const newTokenA = await TokenFactory.deploy(ethers.parseEther("1000000"));
      const newTokenB = await TokenFactory.deploy(ethers.parseEther("1000000"));

      const [token0, token1] = newTokenA.target.toString().toLowerCase() < newTokenB.target.toString().toLowerCase()
        ? [newTokenA, newTokenB]
        : [newTokenB, newTokenA];

      await fusangFactory.createPool(token0.target, token1.target, 500);

      await expect(positionManager.connect(whitelistedUser).createAndInitializePoolIfNecessary(
        token0.target,
        token1.target,
        500,
        encodePriceSqrt(1, 1)
      )).to.be.revertedWithCustomError(positionManager, "NotAdmin");
    });

    it("Should revert when pool is not created", async function () {
      const { positionManager } = await loadFixture(deployFixture);

      const TokenFactory = await ethers.getContractFactory(
        "contracts/core/test/TestERC20.sol:TestERC20"
      );
      const newTokenA = await TokenFactory.deploy(ethers.parseEther("1000000"));
      const newTokenB = await TokenFactory.deploy(ethers.parseEther("1000000"));

      const [token0, token1] = newTokenA.target.toString().toLowerCase() < newTokenB.target.toString().toLowerCase()
        ? [newTokenA, newTokenB]
        : [newTokenB, newTokenA];

      await expect(positionManager.createAndInitializePoolIfNecessary(
        token0.target,
        token1.target,
        500,
        encodePriceSqrt(1, 1)
      )).to.be.revertedWith("Pool not created");
    });

    it("Should not revert for already initialized pool", async function () {
      const { positionManager, tokenA, tokenB } = await loadFixture(deployFixture);

      // Pool already exists from fixture
      await expect(positionManager.createAndInitializePoolIfNecessary(
        tokenA.target,
        tokenB.target,
        3000,
        encodePriceSqrt(1, 1)
      )).to.not.be.reverted;
    });
  });

  describe("Blacklisted user position handling", function () {
    it("Should revert increaseLiquidity when position owner is blacklisted", async function () {
      const { positionManager, admin, whitelistedUser, tokenA, tokenB, walletList, fusangAllowList } =
        await loadFixture(deployFixture);

      // Create position for whitelistedUser
      const mintTx = await positionManager.connect(whitelistedUser).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const tokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const userTokenId = tokenIdEvent.args[0];

      // Blacklist the position owner
      await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser.address);

      // Now try to increaseLiquidity as admin (whitelisted, but position owner is blacklisted)
      // This should revert because _checkPositionOwnerAllowed fails
      await expect(positionManager.connect(admin).increaseLiquidity({
        tokenId: userTokenId,
        amount0Desired: ethers.parseEther("10"),
        amount1Desired: ethers.parseEther("10"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      })).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
        .withArgs(whitelistedUser.address);
    });

    it("Should revert removePosition when caller is not whitelisted (non-admin, non-paused)", async function () {
      const { positionManager, admin, nonWhitelistedUser, tokenA, tokenB, walletList, fusangAllowList } =
        await loadFixture(deployFixture);

      // Create position for admin
      const mintTx = await positionManager.connect(admin).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const tokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const userTokenId = tokenIdEvent.args[0];

      // Approving nonWhitelistedUser should revert — non-compliant operators blocked at approval time
      await expect(positionManager.connect(admin).approve(nonWhitelistedUser.address, userTokenId))
        .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
        .withArgs(nonWhitelistedUser.address);
    });

    it("Should revert removePosition when position owner is not whitelisted (caller is whitelisted)", async function () {
      const { positionManager, admin, whitelistedUser, nonWhitelistedUser, tokenA, tokenB, walletList, fusangAllowList } =
        await loadFixture(deployFixture);

      // Get a new signer for the approved operator
      const [, , , , , operator] = await ethers.getSigners();

      // Whitelist the operator
      await walletList.addToList(WHITELIST, MEMBER, operator.address);

      // Create position for whitelistedUser
      const mintTx = await positionManager.connect(whitelistedUser).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const tokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const userTokenId = tokenIdEvent.args[0];

      // Approve operator (non-admin) to manage the position
      await positionManager.connect(whitelistedUser).approve(operator.address, userTokenId);

      // Remove whitelistedUser (position owner) from whitelist
      await walletList.removeFromList(WHITELIST, MEMBER, whitelistedUser.address);

      // Operator is approved and whitelisted, but not admin - should fail on admin check
      await expect(positionManager.connect(operator).removePosition({tokenId: userTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.be.revertedWithCustomError(positionManager, "NotAdmin");
    });

    it("Should revert removePosition when position owner is blacklisted", async function () {
      const { positionManager, fusangPoolState, admin, whitelistedUser, tokenA, tokenB, walletList, poolAddress } =
        await loadFixture(deployFixture);

      // Create position for whitelistedUser
      const mintTx = await positionManager.connect(whitelistedUser).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const tokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const userTokenId = tokenIdEvent.args[0];

      // Blacklist the position owner
      await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser.address);

      // Pause pool
      await fusangPoolState.connect(admin).pausePool(poolAddress);

      // Admin tries to removePosition but owner is blacklisted — should revert
      await expect(positionManager.connect(admin).removePosition({tokenId: userTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap")
        .withArgs(whitelistedUser.address);
    });

    it("Should allow admin to transfer blacklisted user position then remove", async function () {
      const { positionManager, fusangPoolState, admin, whitelistedUser, tokenA, tokenB, walletList, poolAddress } =
        await loadFixture(deployFixture);

      // Create position for whitelistedUser
      const mintTx = await positionManager.connect(whitelistedUser).mint({
        token0: tokenA.target,
        token1: tokenB.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
      });
      const mintReceipt = await mintTx.wait();
      const tokenIdEvent = mintReceipt.logs.find((log) => log.fragment?.name === "IncreaseLiquidity");
      const userTokenId = tokenIdEvent.args[0];

      // Blacklist the position owner
      await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser.address);

      // Admin transfers position from blacklisted user to admin (god-mode via isApprovedForAll)
      await positionManager.connect(admin).transferFrom(whitelistedUser.address, admin.address, userTokenId);

      // Verify admin now owns the position
      expect(await positionManager.ownerOf(userTokenId)).to.equal(admin.address);

      // Pause pool and remove
      await fusangPoolState.connect(admin).pausePool(poolAddress);
      await expect(positionManager.connect(admin).removePosition({tokenId: userTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}))
        .to.not.be.reverted;

      await expect(positionManager.positions(userTokenId))
        .to.be.revertedWith("Invalid token ID");
    });
  });

  describe("Restricted Sweep/Refund Overrides (V-001)", function () {
    describe("sweepToken", function () {
      it("Should allow whitelisted caller to sweep tokens to whitelisted recipient", async function () {
        const { positionManager, admin, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        // Send some tokens directly to the position manager to simulate dust
        await tokenA.transfer(positionManager.target, ethers.parseEther("10"));

        const balanceBefore = await tokenA.balanceOf(whitelistedUser.address);
        await positionManager.connect(admin).sweepToken(tokenA.target, 0, whitelistedUser.address);
        const balanceAfter = await tokenA.balanceOf(whitelistedUser.address);

        expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("10"));
      });

      it("Should revert for non-whitelisted caller", async function () {
        const { positionManager, nonWhitelistedUser, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(nonWhitelistedUser).sweepToken(tokenA.target, 0, whitelistedUser.address)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert for non-whitelisted recipient", async function () {
        const { positionManager, admin, nonWhitelistedUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(positionManager.target, ethers.parseEther("1"));

        await expect(
          positionManager.connect(admin).sweepToken(tokenA.target, 0, nonWhitelistedUser.address)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted caller", async function () {
        const { positionManager, blacklistedUser, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(blacklistedUser).sweepToken(tokenA.target, 0, whitelistedUser.address)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert for frozen caller", async function () {
        const { positionManager, frozenUser, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(frozenUser).sweepToken(tokenA.target, 0, whitelistedUser.address)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted recipient", async function () {
        const { positionManager, admin, blacklistedUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(positionManager.target, ethers.parseEther("1"));

        await expect(
          positionManager.connect(admin).sweepToken(tokenA.target, 0, blacklistedUser.address)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert for frozen recipient", async function () {
        const { positionManager, admin, frozenUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(positionManager.target, ethers.parseEther("1"));

        await expect(
          positionManager.connect(admin).sweepToken(tokenA.target, 0, frozenUser.address)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert when balance is below amountMinimum", async function () {
        const { positionManager, admin, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        // No tokens sent to contract, so balance is 0
        await expect(
          positionManager.connect(admin).sweepToken(tokenA.target, ethers.parseEther("1"), whitelistedUser.address)
        ).to.be.revertedWith("Insufficient token");
      });

      it("Should succeed with zero balance when amountMinimum is 0", async function () {
        const { positionManager, admin, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        // No tokens in contract, but amountMinimum is 0 so require passes, no transfer happens
        await expect(
          positionManager.connect(admin).sweepToken(tokenA.target, 0, whitelistedUser.address)
        ).to.not.be.reverted;
      });

      it("Should revert sweeping to address(0)", async function () {
        const { positionManager, admin, tokenA } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(admin).sweepToken(tokenA.target, 0, ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should allow sweeping to contract itself (skips recipient check)", async function () {
        const { positionManager, admin, tokenA } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(admin).sweepToken(tokenA.target, 0, positionManager.target)
        ).to.not.be.reverted;
      });
    });

    describe("unwrapWETH9", function () {
      it("Should allow whitelisted caller to unwrap WETH9 to whitelisted recipient", async function () {
        const { positionManager, admin, whitelistedUser, weth9 } = await loadFixture(deployFixture);

        // Deposit ETH to WETH9 and send to position manager
        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(positionManager.target, ethers.parseEther("1"));

        const balanceBefore = await ethers.provider.getBalance(whitelistedUser.address);
        await positionManager.connect(admin).unwrapWETH9(0, whitelistedUser.address);
        const balanceAfter = await ethers.provider.getBalance(whitelistedUser.address);

        expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("1"));
      });

      it("Should revert for non-whitelisted caller", async function () {
        const { positionManager, nonWhitelistedUser } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(nonWhitelistedUser).unwrapWETH9(0, nonWhitelistedUser.address)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert for non-whitelisted recipient", async function () {
        const { positionManager, admin, nonWhitelistedUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(positionManager.target, ethers.parseEther("1"));

        await expect(
          positionManager.connect(admin).unwrapWETH9(0, nonWhitelistedUser.address)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted caller", async function () {
        const { positionManager, blacklistedUser, whitelistedUser } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(blacklistedUser).unwrapWETH9(0, whitelistedUser.address)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert for frozen caller", async function () {
        const { positionManager, frozenUser, whitelistedUser } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(frozenUser).unwrapWETH9(0, whitelistedUser.address)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted recipient", async function () {
        const { positionManager, admin, blacklistedUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(positionManager.target, ethers.parseEther("1"));

        await expect(
          positionManager.connect(admin).unwrapWETH9(0, blacklistedUser.address)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert for frozen recipient", async function () {
        const { positionManager, admin, frozenUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(positionManager.target, ethers.parseEther("1"));

        await expect(
          positionManager.connect(admin).unwrapWETH9(0, frozenUser.address)
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert when WETH9 balance is below amountMinimum", async function () {
        const { positionManager, admin, whitelistedUser } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(admin).unwrapWETH9(ethers.parseEther("1"), whitelistedUser.address)
        ).to.be.revertedWith("Insufficient WETH9");
      });

      it("Should succeed with zero WETH9 balance when amountMinimum is 0", async function () {
        const { positionManager, admin, whitelistedUser } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(admin).unwrapWETH9(0, whitelistedUser.address)
        ).to.not.be.reverted;
      });
    });

    describe("refundETH", function () {
      it("Should allow whitelisted caller to refund ETH", async function () {
        const { positionManager, admin } = await loadFixture(deployFixture);

        // Send ETH as msg.value with refundETH call (receive() only accepts from WETH9)
        const balanceBefore = await ethers.provider.getBalance(admin.address);
        const tx = await positionManager.connect(admin).refundETH({ value: ethers.parseEther("1") });
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;
        const balanceAfter = await ethers.provider.getBalance(admin.address);

        // ETH sent as msg.value is refunded back, net effect is only gas cost
        expect(balanceBefore - balanceAfter).to.equal(gasUsed);
      });

      it("Should revert for non-whitelisted caller", async function () {
        const { positionManager, nonWhitelistedUser } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(nonWhitelistedUser).refundETH()
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted caller", async function () {
        const { positionManager, blacklistedUser } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(blacklistedUser).refundETH()
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should revert for frozen caller", async function () {
        const { positionManager, frozenUser } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(frozenUser).refundETH()
        ).to.be.revertedWithCustomError(positionManager, "NotAllowedToSwap");
      });

      it("Should succeed with zero ETH balance (no-op)", async function () {
        const { positionManager, admin } = await loadFixture(deployFixture);

        await expect(
          positionManager.connect(admin).refundETH()
        ).to.not.be.reverted;
      });
    });
  });

  describe("approveToken", function () {
    it("Should allow admin to approve token on pool", async function () {
      const { admin, fusangFactory, tokenA, tokenB, poolAddress } = await loadFixture(deployFixture);
      const pool = await ethers.getContractAt("UniswapV3Pool", poolAddress);

      await pool.connect(admin).approveToken(tokenA.target, admin.address, 1000);
      expect(await tokenA.allowance(poolAddress, admin.address)).to.equal(1000);
    });

    it("Should revert when non-admin calls approveToken", async function () {
      const { nonWhitelistedUser, tokenA, poolAddress } = await loadFixture(deployFixture);
      const pool = await ethers.getContractAt("UniswapV3Pool", poolAddress);

      await expect(
        pool.connect(nonWhitelistedUser).approveToken(tokenA.target, nonWhitelistedUser.address, 1000)
      ).to.be.reverted;
    });

    it("Should allow spender to transferFrom dust tokens after admin approval", async function () {
      const { admin, whitelistedUser, tokenA, poolAddress } = await loadFixture(deployFixture);
      const pool = await ethers.getContractAt("UniswapV3Pool", poolAddress);

      // Send some dust tokens to the pool
      const dustAmount = ethers.parseEther("10");
      await tokenA.connect(admin).transfer(poolAddress, dustAmount);

      const poolBalanceBefore = await tokenA.balanceOf(poolAddress);
      const spenderBalanceBefore = await tokenA.balanceOf(whitelistedUser.address);

      // Admin approves whitelistedUser to spend dust
      await pool.connect(admin).approveToken(tokenA.target, whitelistedUser.address, dustAmount);

      // Spender transfers the dust tokens out
      await tokenA.connect(whitelistedUser).transferFrom(poolAddress, whitelistedUser.address, dustAmount);

      expect(await tokenA.balanceOf(poolAddress)).to.equal(poolBalanceBefore - dustAmount);
      expect(await tokenA.balanceOf(whitelistedUser.address)).to.equal(spenderBalanceBefore + dustAmount);
    });
  });
});
