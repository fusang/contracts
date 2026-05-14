// @ts-nocheck - Hardhat contracts use dynamic methods not typed in BaseContract
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

import WETH9 from "./contracts/WETH9.json";
import { encodePriceSqrt } from "./shared/encodePriceSqrt";
import { getMaxTick, getMinTick } from "./shared/ticks";

const WHITELIST = ethers.keccak256(ethers.toUtf8Bytes("WHITELIST"));
const BLACKLIST = ethers.keccak256(ethers.toUtf8Bytes("BLACKLIST"));
const FROZENLIST = ethers.keccak256(ethers.toUtf8Bytes("FROZENLIST"));
const MEMBER = ethers.keccak256(ethers.toUtf8Bytes("MEMBER"));
const DEFAULT_ADMIN_ROLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("FusangSwapRouter", function () {
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

    // Deploy test tokens
    const TokenFactory = await ethers.getContractFactory(
      "contracts/core/test/TestERC20.sol:TestERC20"
    );
    const tokenAUnsorted = await TokenFactory.deploy(ethers.parseEther("1000000"));
    const tokenBUnsorted = await TokenFactory.deploy(ethers.parseEther("1000000"));

    // Sort tokens by address for pool creation (PoolInitializer requires token0 < token1)
    const [tokenA, tokenB] = tokenAUnsorted.target.toLowerCase() < tokenBUnsorted.target.toLowerCase()
      ? [tokenAUnsorted, tokenBUnsorted]
      : [tokenBUnsorted, tokenAUnsorted];

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

    // Deploy FusangSwapRouter
    const FusangSwapRouter = await ethers.getContractFactory("FusangSwapRouter");
    const swapRouter = await FusangSwapRouter.deploy(
      fusangFactory.target,
      weth9.target,
      fusangPoolState.target
    );

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

    // Add contracts to whitelist and allowlist
    await walletList.addToList(WHITELIST, MEMBER, positionManager.target);
    await walletList.addToList(WHITELIST, MEMBER, swapRouter.target);
    await fusangAllowList.setAllowed(positionManager.target, true);
    await fusangAllowList.setAllowed(swapRouter.target, true);

    // Approve tokens and transfer
    const tokens = [tokenA, tokenB];
    for (const token of tokens) {
      await token.approve(swapRouter.target, ethers.MaxUint256);
      await token.approve(positionManager.target, ethers.MaxUint256);
      await token.connect(whitelistedUser).approve(swapRouter.target, ethers.MaxUint256);
      await token.connect(whitelistedUser).approve(positionManager.target, ethers.MaxUint256);
      await token.transfer(whitelistedUser.address, ethers.parseEther("100000"));
      await token.transfer(nonWhitelistedUser.address, ethers.parseEther("100000"));
      await token.connect(nonWhitelistedUser).approve(swapRouter.target, ethers.MaxUint256);
    }

    // Create and initialize pool
    await fusangFactory.createPool(tokenA.target, tokenB.target, 3000);
    await positionManager.createAndInitializePoolIfNecessary(
      tokenA.target,
      tokenB.target,
      3000,
      encodePriceSqrt(1, 1)
    );

    const poolAddress = await fusangFactory.getPool(tokenA.target, tokenB.target, 3000);

    // Provide liquidity
    await positionManager.connect(admin).mint({
      token0: tokenA.target,
      token1: tokenB.target,
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

    return {
      admin,
      whitelistedUser,
      nonWhitelistedUser,
      blacklistedUser,
      frozenUser,
      tokenA,
      tokenB,
      weth9,
      swapRouter,
      positionManager,
      walletList,
      fusangFactory,
      fusangAllowList,
      fusangPoolState,
      poolAddress,
    };
  }

  describe("Deployment", function () {
    it("Should set correct factoryContract", async function () {
      const { swapRouter, fusangFactory } = await loadFixture(deployFixture);

      expect(await swapRouter.factoryContract()).to.equal(fusangFactory.target);
    });

    it("Should set correct poolStateContract", async function () {
      const { swapRouter, fusangPoolState } = await loadFixture(deployFixture);

      expect(await swapRouter.poolStateContract()).to.equal(fusangPoolState.target);
    });

    it("Should set correct factory", async function () {
      const { swapRouter, fusangFactory } = await loadFixture(deployFixture);

      expect(await swapRouter.factory()).to.equal(fusangFactory.target);
    });
  });

  describe("Access Control", function () {
    describe("exactInputSingle", function () {
      it("Should allow whitelisted user to swap", async function () {
        const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const params = {
          tokenIn: tokenA.target,
          tokenOut: tokenB.target,
          fee: 3000,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
          amountIn: ethers.parseEther("10"),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        };

        await expect(swapRouter.connect(whitelistedUser).exactInputSingle(params))
          .to.not.be.reverted;
      });

      it("Should revert for non-whitelisted user", async function () {
        const { swapRouter, nonWhitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const params = {
          tokenIn: tokenA.target,
          tokenOut: tokenB.target,
          fee: 3000,
          recipient: nonWhitelistedUser.address,
          deadline: ethers.MaxUint256,
          amountIn: ethers.parseEther("10"),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        };

        await expect(swapRouter.connect(nonWhitelistedUser).exactInputSingle(params))
          .to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted user", async function () {
        const { swapRouter, blacklistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const params = {
          tokenIn: tokenA.target,
          tokenOut: tokenB.target,
          fee: 3000,
          recipient: blacklistedUser.address,
          deadline: ethers.MaxUint256,
          amountIn: ethers.parseEther("10"),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        };

        await expect(swapRouter.connect(blacklistedUser).exactInputSingle(params))
          .to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for frozen user", async function () {
        const { swapRouter, frozenUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const params = {
          tokenIn: tokenA.target,
          tokenOut: tokenB.target,
          fee: 3000,
          recipient: frozenUser.address,
          deadline: ethers.MaxUint256,
          amountIn: ethers.parseEther("10"),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        };

        await expect(swapRouter.connect(frozenUser).exactInputSingle(params))
          .to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for non-whitelisted recipient", async function () {
        const { swapRouter, whitelistedUser, nonWhitelistedUser, tokenA, tokenB } =
          await loadFixture(deployFixture);

        const params = {
          tokenIn: tokenA.target,
          tokenOut: tokenB.target,
          fee: 3000,
          recipient: nonWhitelistedUser.address,
          deadline: ethers.MaxUint256,
          amountIn: ethers.parseEther("10"),
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        };

        await expect(swapRouter.connect(whitelistedUser).exactInputSingle(params))
          .to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });
    });

    describe("exactInput", function () {
      it("Should allow whitelisted user to swap with path", async function () {
        const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const path = ethers.solidityPacked(
          ["address", "uint24", "address"],
          [tokenA.target, 3000, tokenB.target]
        );

        const params = {
          path: path,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
          amountIn: ethers.parseEther("10"),
          amountOutMinimum: 0,
        };

        await expect(swapRouter.connect(whitelistedUser).exactInput(params))
          .to.not.be.reverted;
      });

      it("Should revert for non-whitelisted user", async function () {
        const { swapRouter, nonWhitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const path = ethers.solidityPacked(
          ["address", "uint24", "address"],
          [tokenA.target, 3000, tokenB.target]
        );

        const params = {
          path: path,
          recipient: nonWhitelistedUser.address,
          deadline: ethers.MaxUint256,
          amountIn: ethers.parseEther("10"),
          amountOutMinimum: 0,
        };

        await expect(swapRouter.connect(nonWhitelistedUser).exactInput(params))
          .to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });
    });

    describe("exactOutputSingle", function () {
      it("Should allow whitelisted user to swap", async function () {
        const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const params = {
          tokenIn: tokenA.target,
          tokenOut: tokenB.target,
          fee: 3000,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
          amountOut: ethers.parseEther("5"),
          amountInMaximum: ethers.parseEther("10"),
          sqrtPriceLimitX96: 0,
        };

        await expect(swapRouter.connect(whitelistedUser).exactOutputSingle(params))
          .to.not.be.reverted;
      });

      it("Should revert for non-whitelisted user", async function () {
        const { swapRouter, nonWhitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const params = {
          tokenIn: tokenA.target,
          tokenOut: tokenB.target,
          fee: 3000,
          recipient: nonWhitelistedUser.address,
          deadline: ethers.MaxUint256,
          amountOut: ethers.parseEther("5"),
          amountInMaximum: ethers.parseEther("10"),
          sqrtPriceLimitX96: 0,
        };

        await expect(swapRouter.connect(nonWhitelistedUser).exactOutputSingle(params))
          .to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });
    });

    describe("exactOutput", function () {
      it("Should allow whitelisted user to swap with path", async function () {
        const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const path = ethers.solidityPacked(
          ["address", "uint24", "address"],
          [tokenB.target, 3000, tokenA.target]
        );

        const params = {
          path: path,
          recipient: whitelistedUser.address,
          deadline: ethers.MaxUint256,
          amountOut: ethers.parseEther("5"),
          amountInMaximum: ethers.parseEther("10"),
        };

        await expect(swapRouter.connect(whitelistedUser).exactOutput(params))
          .to.not.be.reverted;
      });

      it("Should revert for non-whitelisted user", async function () {
        const { swapRouter, nonWhitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

        const path = ethers.solidityPacked(
          ["address", "uint24", "address"],
          [tokenB.target, 3000, tokenA.target]
        );

        const params = {
          path: path,
          recipient: nonWhitelistedUser.address,
          deadline: ethers.MaxUint256,
          amountOut: ethers.parseEther("5"),
          amountInMaximum: ethers.parseEther("10"),
        };

        await expect(swapRouter.connect(nonWhitelistedUser).exactOutput(params))
          .to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });
    });
  });

  describe("Pool State Checks", function () {
    it("Should revert when pool is paused", async function () {
      const { swapRouter, fusangPoolState, admin, whitelistedUser, tokenA, tokenB, poolAddress } =
        await loadFixture(deployFixture);

      await fusangPoolState.connect(admin).pausePool(poolAddress);

      const params = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactInputSingle(params))
        .to.be.revertedWithCustomError(swapRouter, "PoolNotActive");
    });

    it("Should revert when pool is closed", async function () {
      const { swapRouter, fusangPoolState, admin, whitelistedUser, tokenA, tokenB, poolAddress } =
        await loadFixture(deployFixture);

      const pastDate = (await time.latest()) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(poolAddress, pastDate);

      const params = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactInputSingle(params))
        .to.be.revertedWithCustomError(swapRouter, "PoolNotActive");
    });

    it("Should allow swap after unpausing", async function () {
      const { swapRouter, fusangPoolState, admin, whitelistedUser, tokenA, tokenB, poolAddress } =
        await loadFixture(deployFixture);

      await fusangPoolState.connect(admin).pausePool(poolAddress);
      await fusangPoolState.connect(admin).unpausePool(poolAddress);

      const params = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactInputSingle(params))
        .to.not.be.reverted;
    });

    it("Should allow swap after removing close date", async function () {
      const { swapRouter, fusangPoolState, admin, whitelistedUser, tokenA, tokenB, poolAddress } =
        await loadFixture(deployFixture);

      const pastDate = (await time.latest()) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(poolAddress, pastDate);

      // Remove close date
      await fusangPoolState.connect(admin).setPoolCloseDate(poolAddress, 0);

      const params = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactInputSingle(params))
        .to.not.be.reverted;
    });
  });

  describe("Deadline validation", function () {
    it("exactInputSingle should revert when deadline has passed", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const pastDeadline = (await time.latest()) - 1;

      const params = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: pastDeadline,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactInputSingle(params))
        .to.be.revertedWith("Transaction too old");
    });

    it("exactInput should revert when deadline has passed", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const pastDeadline = (await time.latest()) - 1;

      const path = ethers.solidityPacked(
        ["address", "uint24", "address"],
        [tokenA.target, 3000, tokenB.target]
      );

      const params = {
        path: path,
        recipient: whitelistedUser.address,
        deadline: pastDeadline,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactInput(params))
        .to.be.revertedWith("Transaction too old");
    });

    it("exactOutputSingle should revert when deadline has passed", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const pastDeadline = (await time.latest()) - 1;

      const params = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: pastDeadline,
        amountOut: ethers.parseEther("5"),
        amountInMaximum: ethers.parseEther("10"),
        sqrtPriceLimitX96: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactOutputSingle(params))
        .to.be.revertedWith("Transaction too old");
    });

    it("exactOutput should revert when deadline has passed", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const pastDeadline = (await time.latest()) - 1;

      const path = ethers.solidityPacked(
        ["address", "uint24", "address"],
        [tokenB.target, 3000, tokenA.target]
      );

      const params = {
        path: path,
        recipient: whitelistedUser.address,
        deadline: pastDeadline,
        amountOut: ethers.parseEther("5"),
        amountInMaximum: ethers.parseEther("10"),
      };

      await expect(swapRouter.connect(whitelistedUser).exactOutput(params))
        .to.be.revertedWith("Transaction too old");
    });
  });

  describe("canSwap function", function () {
    it("Should return true for whitelisted user", async function () {
      const { swapRouter, whitelistedUser } = await loadFixture(deployFixture);

      expect(await swapRouter.canSwap(whitelistedUser.address)).to.be.true;
    });

    it("Should return false for non-whitelisted user", async function () {
      const { swapRouter, nonWhitelistedUser } = await loadFixture(deployFixture);

      expect(await swapRouter.canSwap(nonWhitelistedUser.address)).to.be.false;
    });

    it("Should return false for blacklisted user", async function () {
      const { swapRouter, blacklistedUser } = await loadFixture(deployFixture);

      expect(await swapRouter.canSwap(blacklistedUser.address)).to.be.false;
    });

    it("Should return false for frozen user", async function () {
      const { swapRouter, frozenUser } = await loadFixture(deployFixture);

      expect(await swapRouter.canSwap(frozenUser.address)).to.be.false;
    });
  });

  describe("Slippage checks", function () {
    it("exactInputSingle should revert when amountOut is below minimum", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const params = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: ethers.parseEther("1000"), // Unreasonably high minimum
        sqrtPriceLimitX96: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactInputSingle(params))
        .to.be.revertedWith("Too little received");
    });

    it("exactInput should revert when amountOut is below minimum", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address"],
        [tokenA.target, 3000, tokenB.target]
      );

      const params = {
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: ethers.parseEther("1000"), // Unreasonably high minimum
      };

      await expect(swapRouter.connect(whitelistedUser).exactInput(params))
        .to.be.revertedWith("Too little received");
    });

    it("exactOutputSingle should revert when amountIn exceeds maximum", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const params = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("100"),
        amountInMaximum: ethers.parseEther("1"), // Too low maximum
        sqrtPriceLimitX96: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactOutputSingle(params))
        .to.be.revertedWith("Too much requested");
    });

    it("exactOutput should revert when amountIn exceeds maximum", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address"],
        [tokenB.target, 3000, tokenA.target]
      );

      const params = {
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("100"),
        amountInMaximum: ethers.parseEther("1"), // Too low maximum
      };

      await expect(swapRouter.connect(whitelistedUser).exactOutput(params))
        .to.be.revertedWith("Too much requested");
    });
  });

  describe("Swap direction (tokenOut < tokenIn)", function () {
    it("exactInputSingle should work when swapping tokenB for tokenA", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      // Swap in reverse direction (tokenB -> tokenA)
      const params = {
        tokenIn: tokenB.target,
        tokenOut: tokenA.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactInputSingle(params))
        .to.not.be.reverted;
    });

    it("exactOutputSingle should work when swapping tokenB for tokenA", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      // Swap in reverse direction (tokenB for tokenA)
      const params = {
        tokenIn: tokenB.target,
        tokenOut: tokenA.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("5"),
        amountInMaximum: ethers.parseEther("100"),
        sqrtPriceLimitX96: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactOutputSingle(params))
        .to.not.be.reverted;
    });
  });

  describe("sqrtPriceLimitX96 parameter", function () {
    it("exactInputSingle should work with non-zero sqrtPriceLimitX96", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      // Use a price limit that allows the swap (MIN_SQRT_RATIO + 1 for zeroForOne)
      const sqrtPriceLimitX96 = "4295128740"; // MIN_SQRT_RATIO + 1

      const params = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("1"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: sqrtPriceLimitX96,
      };

      await expect(swapRouter.connect(whitelistedUser).exactInputSingle(params))
        .to.not.be.reverted;
    });

    it("exactOutputSingle should work with non-zero sqrtPriceLimitX96", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      // Use a price limit that allows the swap
      const sqrtPriceLimitX96 = "4295128740"; // MIN_SQRT_RATIO + 1

      const params = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("0.5"),
        amountInMaximum: ethers.parseEther("10"),
        sqrtPriceLimitX96: sqrtPriceLimitX96,
      };

      await expect(swapRouter.connect(whitelistedUser).exactOutputSingle(params))
        .to.not.be.reverted;
    });
  });

  describe("Recipient address(0) handling", function () {
    it("exactInputSingle should revert with address(0) recipient", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const params = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: ethers.ZeroAddress,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactInputSingle(params))
        .to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
    });

    it("exactInput should revert with address(0) recipient", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address"],
        [tokenA.target, 3000, tokenB.target]
      );

      const params = {
        path: path,
        recipient: ethers.ZeroAddress,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactInput(params))
        .to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
    });

    it("exactOutputSingle should revert with address(0) recipient", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const params = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: ethers.ZeroAddress,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("5"),
        amountInMaximum: ethers.parseEther("10"),
        sqrtPriceLimitX96: 0,
      };

      await expect(swapRouter.connect(whitelistedUser).exactOutputSingle(params))
        .to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
    });

    it("exactOutput should revert with address(0) recipient", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address"],
        [tokenB.target, 3000, tokenA.target]
      );

      const params = {
        path: path,
        recipient: ethers.ZeroAddress,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("5"),
        amountInMaximum: ethers.parseEther("10"),
      };

      await expect(swapRouter.connect(whitelistedUser).exactOutput(params))
        .to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
    });
  });

  describe("Multicall swap flows", function () {
    async function deployWethPoolFixture() {
      const base = await deployFixture();
      const { admin, whitelistedUser, weth9, swapRouter, positionManager, walletList, fusangAllowList, fusangFactory } = base;

      // Sort WETH and tokenA for pool creation
      const [token0, token1] = weth9.target.toLowerCase() < base.tokenA.target.toLowerCase()
        ? [weth9, base.tokenA]
        : [base.tokenA, weth9];

      // Whitelist WETH deposit: admin deposits ETH to get WETH
      await weth9.deposit({ value: ethers.parseEther("200") });
      await weth9.approve(positionManager.target, ethers.MaxUint256);
      await weth9.approve(swapRouter.target, ethers.MaxUint256);

      // Whitelisted user also gets WETH
      await weth9.connect(whitelistedUser).deposit({ value: ethers.parseEther("200") });
      await weth9.connect(whitelistedUser).approve(swapRouter.target, ethers.MaxUint256);
      await weth9.connect(whitelistedUser).approve(positionManager.target, ethers.MaxUint256);

      // Create and initialize WETH-tokenA pool
      await fusangFactory.createPool(token0.target, token1.target, 3000);
      await positionManager.createAndInitializePoolIfNecessary(
        token0.target,
        token1.target,
        3000,
        encodePriceSqrt(1, 1)
      );

      // Provide liquidity to WETH-tokenA pool
      await positionManager.connect(admin).mint({
        token0: token0.target,
        token1: token1.target,
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

      return { ...base, token0Weth: token0, token1Weth: token1 };
    }

    it("multicall([exactInputSingle, unwrapWETH9]) — swap then unwrap ETH with balance check", async function () {
      const { swapRouter, whitelistedUser, tokenA, weth9 } = await loadFixture(deployWethPoolFixture);

      const ethBefore = await ethers.provider.getBalance(whitelistedUser.address);
      const tokenABefore = await tokenA.balanceOf(whitelistedUser.address);

      const amountIn = ethers.parseEther("10");

      const swapData = swapRouter.interface.encodeFunctionData("exactInputSingle", [{
        tokenIn: tokenA.target,
        tokenOut: weth9.target,
        fee: 3000,
        recipient: swapRouter.target,
        deadline: ethers.MaxUint256,
        amountIn: amountIn,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      }]);

      const unwrapData = swapRouter.interface.encodeFunctionData("unwrapWETH9", [
        0,
        whitelistedUser.address,
      ]);

      const tx = await swapRouter.connect(whitelistedUser).multicall([swapData, unwrapData]);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const ethAfter = await ethers.provider.getBalance(whitelistedUser.address);
      const tokenAAfter = await tokenA.balanceOf(whitelistedUser.address);

      // tokenA decreased by amountIn
      expect(tokenABefore - tokenAAfter).to.equal(amountIn);
      // ETH increased (received unwrapped WETH minus gas)
      expect(ethAfter + gasCost).to.be.gt(ethBefore);
    });

    it("multicall([exactOutputSingle, unwrapWETH9, refundETH]) — swap exact output then unwrap + refund", async function () {
      const { swapRouter, whitelistedUser, tokenA, weth9 } = await loadFixture(deployWethPoolFixture);

      const swapData = swapRouter.interface.encodeFunctionData("exactOutputSingle", [{
        tokenIn: tokenA.target,
        tokenOut: weth9.target,
        fee: 3000,
        recipient: swapRouter.target,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("5"),
        amountInMaximum: ethers.parseEther("10"),
        sqrtPriceLimitX96: 0,
      }]);

      const unwrapData = swapRouter.interface.encodeFunctionData("unwrapWETH9", [
        0,
        whitelistedUser.address,
      ]);

      const refundData = swapRouter.interface.encodeFunctionData("refundETH");

      await expect(swapRouter.connect(whitelistedUser).multicall([swapData, unwrapData, refundData]))
        .to.not.be.reverted;
    });

    it("multicall([exactInputSingle, sweepTokenWithFee]) — swap then sweep with fee split verification", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB, admin } = await loadFixture(deployFixture);

      const userBefore = await tokenB.balanceOf(whitelistedUser.address);
      const feeBefore = await tokenB.balanceOf(admin.address);

      const swapData = swapRouter.interface.encodeFunctionData("exactInputSingle", [{
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: swapRouter.target,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      }]);

      const sweepData = swapRouter.interface.encodeFunctionData("sweepTokenWithFee", [
        tokenB.target,
        0,
        whitelistedUser.address,
        100, // 1% fee (100 bips)
        admin.address,
      ]);

      await swapRouter.connect(whitelistedUser).multicall([swapData, sweepData]);

      const userAfter = await tokenB.balanceOf(whitelistedUser.address);
      const feeAfter = await tokenB.balanceOf(admin.address);

      const userReceived = userAfter - userBefore;
      const feeReceived = feeAfter - feeBefore;

      // User received tokens
      expect(userReceived).to.be.gt(0);
      // Fee recipient received tokens
      expect(feeReceived).to.be.gt(0);
      // Fee is ~1% of total output
      const totalOutput = userReceived + feeReceived;
      expect(feeReceived).to.equal(totalOutput / 100n);
    });

    it("multicall([exactInputSingle, unwrapWETH9WithFee]) — swap then unwrap with fee split verification", async function () {
      const { swapRouter, whitelistedUser, tokenA, weth9, admin } = await loadFixture(deployWethPoolFixture);

      const userEthBefore = await ethers.provider.getBalance(whitelistedUser.address);
      const feeEthBefore = await ethers.provider.getBalance(admin.address);

      const swapData = swapRouter.interface.encodeFunctionData("exactInputSingle", [{
        tokenIn: tokenA.target,
        tokenOut: weth9.target,
        fee: 3000,
        recipient: swapRouter.target,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      }]);

      const unwrapData = swapRouter.interface.encodeFunctionData("unwrapWETH9WithFee", [
        0,
        whitelistedUser.address,
        100, // 1% fee
        admin.address,
      ]);

      const tx = await swapRouter.connect(whitelistedUser).multicall([swapData, unwrapData]);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const userEthAfter = await ethers.provider.getBalance(whitelistedUser.address);
      const feeEthAfter = await ethers.provider.getBalance(admin.address);

      // User received ETH (minus gas)
      const userReceived = userEthAfter + gasCost - userEthBefore;
      expect(userReceived).to.be.gt(0);
      // Fee recipient received ETH
      const feeReceived = feeEthAfter - feeEthBefore;
      expect(feeReceived).to.be.gt(0);
    });

    it("multicall([exactInputSingle, refundETH]) — swap with ETH refund", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB } = await loadFixture(deployFixture);

      const swapData = swapRouter.interface.encodeFunctionData("exactInputSingle", [{
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      }]);

      const refundData = swapRouter.interface.encodeFunctionData("refundETH");

      await expect(swapRouter.connect(whitelistedUser).multicall([swapData, refundData]))
        .to.not.be.reverted;
    });
  });

  describe("Multicall multi-hop swap flows", function () {
    async function deployMultiHopWethFixture() {
      const [admin, whitelistedUser] = await ethers.getSigners();

      const WalletListFactory = await ethers.getContractFactory("WalletList");
      const walletList = await WalletListFactory.deploy();

      const WETH9Factory = await ethers.getContractFactory(WETH9.abi, WETH9.bytecode);
      const weth9 = await WETH9Factory.deploy();

      const TokenFactory = await ethers.getContractFactory("contracts/core/test/TestERC20.sol:TestERC20");
      const tokenA = await TokenFactory.deploy(ethers.parseEther("1000000"));
      const tokenB = await TokenFactory.deploy(ethers.parseEther("1000000"));

      const FusangAllowList = await ethers.getContractFactory("FusangAllowList");
      const fusangAllowList = await FusangAllowList.deploy(walletList.target);

      const FusangFactory = await ethers.getContractFactory("FusangFactory");
      const fusangFactory = await FusangFactory.deploy(fusangAllowList.target);

      const FusangPoolState = await ethers.getContractFactory("FusangPoolState");
      const fusangPoolState = await FusangPoolState.deploy(fusangFactory.target);

      await walletList.setRoleManageList(BLACKLIST, DEFAULT_ADMIN_ROLE, true);
      await walletList.addToList(MEMBER, DEFAULT_ADMIN_ROLE, admin.address);
      await walletList.addToList(WHITELIST, MEMBER, whitelistedUser.address);
      await walletList.addToList(WHITELIST, MEMBER, admin.address);

      const FusangSwapRouter = await ethers.getContractFactory("FusangSwapRouter");
      const swapRouter = await FusangSwapRouter.deploy(fusangFactory.target, weth9.target, fusangPoolState.target);

      const NFTDescriptorFactory = await ethers.getContractFactory("NFTDescriptor");
      const nftDescriptorLibrary = await NFTDescriptorFactory.deploy();
      const NonfungibleTokenPositionDescriptorFactory = await ethers.getContractFactory("NonfungibleTokenPositionDescriptor", {
        libraries: { NFTDescriptor: nftDescriptorLibrary.target },
      });
      const nonfungibleTokenPositionDescriptor = await NonfungibleTokenPositionDescriptorFactory.deploy(weth9.target, ethers.encodeBytes32String("ETH"));

      const FusangNonfungiblePositionManager = await ethers.getContractFactory("FusangNonfungiblePositionManager");
      const positionManager = await FusangNonfungiblePositionManager.deploy(fusangFactory.target, weth9.target, nonfungibleTokenPositionDescriptor.target, fusangPoolState.target);

      await walletList.addToList(WHITELIST, MEMBER, positionManager.target);
      await walletList.addToList(WHITELIST, MEMBER, swapRouter.target);
      await fusangAllowList.setAllowed(positionManager.target, true);
      await fusangAllowList.setAllowed(swapRouter.target, true);
      await fusangAllowList.setAllowed(admin.address, true);
      await fusangAllowList.setAllowed(whitelistedUser.address, true);

      // Approve tokens
      for (const token of [tokenA, tokenB]) {
        await token.approve(swapRouter.target, ethers.MaxUint256);
        await token.approve(positionManager.target, ethers.MaxUint256);
        await token.connect(whitelistedUser).approve(swapRouter.target, ethers.MaxUint256);
        await token.connect(whitelistedUser).approve(positionManager.target, ethers.MaxUint256);
        await token.transfer(whitelistedUser.address, ethers.parseEther("100000"));
      }

      // WETH setup
      await weth9.deposit({ value: ethers.parseEther("200") });
      await weth9.approve(positionManager.target, ethers.MaxUint256);
      await weth9.approve(swapRouter.target, ethers.MaxUint256);
      await weth9.connect(whitelistedUser).deposit({ value: ethers.parseEther("200") });
      await weth9.connect(whitelistedUser).approve(swapRouter.target, ethers.MaxUint256);

      // Sort and create pool: tokenA-tokenB
      const [t0AB, t1AB] = tokenA.target.toLowerCase() < tokenB.target.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
      await fusangFactory.createPool(t0AB.target, t1AB.target, 3000);
      await positionManager.createAndInitializePoolIfNecessary(t0AB.target, t1AB.target, 3000, encodePriceSqrt(1, 1));
      await positionManager.connect(admin).mint({
        token0: t0AB.target, token1: t1AB.target, fee: 3000,
        tickLower: getMinTick(60), tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("10000"), amount1Desired: ethers.parseEther("10000"),
        amount0Min: 0, amount1Min: 0, recipient: admin.address, deadline: ethers.MaxUint256,
      });

      // Sort and create pool: tokenB-WETH
      const [t0BW, t1BW] = tokenB.target.toLowerCase() < weth9.target.toLowerCase() ? [tokenB, weth9] : [weth9, tokenB];
      await fusangFactory.createPool(t0BW.target, t1BW.target, 3000);
      await positionManager.createAndInitializePoolIfNecessary(t0BW.target, t1BW.target, 3000, encodePriceSqrt(1, 1));
      await positionManager.connect(admin).mint({
        token0: t0BW.target, token1: t1BW.target, fee: 3000,
        tickLower: getMinTick(60), tickUpper: getMaxTick(60),
        amount0Desired: ethers.parseEther("100"), amount1Desired: ethers.parseEther("100"),
        amount0Min: 0, amount1Min: 0, recipient: admin.address, deadline: ethers.MaxUint256,
      });

      return { admin, whitelistedUser, tokenA, tokenB, weth9, swapRouter, positionManager };
    }

    it("multicall([exactInput, unwrapWETH9]) — multihop A->B->WETH with balance check", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB, weth9 } = await loadFixture(deployMultiHopWethFixture);

      const amountIn = ethers.parseEther("10");
      const tokenABefore = await tokenA.balanceOf(whitelistedUser.address);
      const ethBefore = await ethers.provider.getBalance(whitelistedUser.address);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address", "uint24", "address"],
        [tokenA.target, 3000, tokenB.target, 3000, weth9.target]
      );

      const swapData = swapRouter.interface.encodeFunctionData("exactInput", [{
        path: path,
        recipient: swapRouter.target,
        deadline: ethers.MaxUint256,
        amountIn: amountIn,
        amountOutMinimum: 0,
      }]);

      const unwrapData = swapRouter.interface.encodeFunctionData("unwrapWETH9", [0, whitelistedUser.address]);

      const tx = await swapRouter.connect(whitelistedUser).multicall([swapData, unwrapData]);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const tokenAAfter = await tokenA.balanceOf(whitelistedUser.address);
      const ethAfter = await ethers.provider.getBalance(whitelistedUser.address);

      // tokenA decreased by amountIn
      expect(tokenABefore - tokenAAfter).to.equal(amountIn);
      // ETH increased (received unwrapped WETH minus gas)
      expect(ethAfter + gasCost).to.be.gt(ethBefore);
      // No WETH left in router
      expect(await weth9.balanceOf(swapRouter.target)).to.equal(0);
    });

    it("multicall([exactOutput, unwrapWETH9]) — multihop exact output with balance check", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB, weth9 } = await loadFixture(deployMultiHopWethFixture);

      const amountOut = ethers.parseEther("5");
      const tokenABefore = await tokenA.balanceOf(whitelistedUser.address);
      const ethBefore = await ethers.provider.getBalance(whitelistedUser.address);

      // exactOutput path is reversed: output token first
      const path = ethers.solidityPacked(
        ["address", "uint24", "address", "uint24", "address"],
        [weth9.target, 3000, tokenB.target, 3000, tokenA.target]
      );

      const swapData = swapRouter.interface.encodeFunctionData("exactOutput", [{
        path: path,
        recipient: swapRouter.target,
        deadline: ethers.MaxUint256,
        amountOut: amountOut,
        amountInMaximum: ethers.parseEther("100"),
      }]);

      const unwrapData = swapRouter.interface.encodeFunctionData("unwrapWETH9", [0, whitelistedUser.address]);

      const tx = await swapRouter.connect(whitelistedUser).multicall([swapData, unwrapData]);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const tokenAAfter = await tokenA.balanceOf(whitelistedUser.address);
      const ethAfter = await ethers.provider.getBalance(whitelistedUser.address);

      // tokenA decreased (paid input)
      expect(tokenAAfter).to.be.lt(tokenABefore);
      // ETH increased by at least amountOut minus gas
      expect(ethAfter + gasCost).to.be.gt(ethBefore);
      // No WETH left in router
      expect(await weth9.balanceOf(swapRouter.target)).to.equal(0);
    });
  });

  describe("Multi-hop swaps", function () {
    async function deployMultiHopFixture() {
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

      // Deploy test tokens (3 tokens for multi-hop)
      const TokenFactory = await ethers.getContractFactory(
        "contracts/core/test/TestERC20.sol:TestERC20"
      );
      const tokenA = await TokenFactory.deploy(ethers.parseEther("1000000"));
      const tokenB = await TokenFactory.deploy(ethers.parseEther("1000000"));
      const tokenC = await TokenFactory.deploy(ethers.parseEther("1000000"));

      // Deploy FusangAllowList (uses walletList for admin)
      const FusangAllowList = await ethers.getContractFactory("FusangAllowList");
      const fusangAllowList = await FusangAllowList.deploy(walletList.target);

      // Deploy FusangFactory with allowList
      const FusangFactory = await ethers.getContractFactory("FusangFactory");
      const fusangFactory = await FusangFactory.deploy(fusangAllowList.target);

      // Deploy FusangPoolState
      const FusangPoolState = await ethers.getContractFactory("FusangPoolState");
      const fusangPoolState = await FusangPoolState.deploy(fusangFactory.target);

      // Configure WalletList (WHITELIST→MEMBER and FROZENLIST→MEMBER already set in constructor)
      await walletList.setRoleManageList(BLACKLIST, DEFAULT_ADMIN_ROLE, true);
      await walletList.addToList(MEMBER, DEFAULT_ADMIN_ROLE, admin.address);
      await walletList.addToList(WHITELIST, MEMBER, whitelistedUser.address);
      await walletList.addToList(WHITELIST, MEMBER, admin.address);

      // Deploy FusangSwapRouter
      const FusangSwapRouter = await ethers.getContractFactory("FusangSwapRouter");
      const swapRouter = await FusangSwapRouter.deploy(
        fusangFactory.target,
        weth9.target,
        fusangPoolState.target
      );

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

      // Add contracts to whitelist and allowlist
      await walletList.addToList(WHITELIST, MEMBER, positionManager.target);
      await walletList.addToList(WHITELIST, MEMBER, swapRouter.target);
      await fusangAllowList.setAllowed(positionManager.target, true);
      await fusangAllowList.setAllowed(swapRouter.target, true);
      await fusangAllowList.setAllowed(admin.address, true);
      await fusangAllowList.setAllowed(whitelistedUser.address, true);

      // Approve tokens
      const tokens = [tokenA, tokenB, tokenC];
      for (const token of tokens) {
        await token.approve(swapRouter.target, ethers.MaxUint256);
        await token.approve(positionManager.target, ethers.MaxUint256);
        await token.connect(whitelistedUser).approve(swapRouter.target, ethers.MaxUint256);
        await token.connect(whitelistedUser).approve(positionManager.target, ethers.MaxUint256);
        await token.transfer(whitelistedUser.address, ethers.parseEther("100000"));
      }

      // Sort tokens for proper ordering
      const [token0AB, token1AB] = tokenA.target.toLowerCase() < tokenB.target.toLowerCase()
        ? [tokenA, tokenB]
        : [tokenB, tokenA];
      const [token0BC, token1BC] = tokenB.target.toLowerCase() < tokenC.target.toLowerCase()
        ? [tokenB, tokenC]
        : [tokenC, tokenB];

      // Create and initialize pool A-B
      await fusangFactory.createPool(token0AB.target, token1AB.target, 3000);
      await positionManager.createAndInitializePoolIfNecessary(
        token0AB.target,
        token1AB.target,
        3000,
        encodePriceSqrt(1, 1)
      );

      // Create and initialize pool B-C
      await fusangFactory.createPool(token0BC.target, token1BC.target, 3000);
      await positionManager.createAndInitializePoolIfNecessary(
        token0BC.target,
        token1BC.target,
        3000,
        encodePriceSqrt(1, 1)
      );

      // Provide liquidity to pool A-B
      await positionManager.connect(admin).mint({
        token0: token0AB.target,
        token1: token1AB.target,
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

      // Provide liquidity to pool B-C
      await positionManager.connect(admin).mint({
        token0: token0BC.target,
        token1: token1BC.target,
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

      return {
        admin,
        whitelistedUser,
        tokenA,
        tokenB,
        tokenC,
        swapRouter,
        positionManager,
        walletList,
        fusangFactory,
        fusangAllowList,
        fusangPoolState,
      };
    }

    it("exactInput A -> B -> C with balance verification", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB, tokenC } =
        await loadFixture(deployMultiHopFixture);

      const amountIn = ethers.parseEther("10");

      const balanceA_before = await tokenA.balanceOf(whitelistedUser.address);
      const balanceC_before = await tokenC.balanceOf(whitelistedUser.address);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address", "uint24", "address"],
        [tokenA.target, 3000, tokenB.target, 3000, tokenC.target]
      );

      await swapRouter.connect(whitelistedUser).exactInput({
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: amountIn,
        amountOutMinimum: 0,
      });

      const balanceA_after = await tokenA.balanceOf(whitelistedUser.address);
      const balanceC_after = await tokenC.balanceOf(whitelistedUser.address);

      // tokenA decreased by amountIn
      expect(balanceA_before - balanceA_after).to.equal(amountIn);
      // tokenC increased (received output)
      expect(balanceC_after).to.be.gt(balanceC_before);
    });

    it("exactInput C -> B -> A reverse direction with balance verification", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB, tokenC } =
        await loadFixture(deployMultiHopFixture);

      const amountIn = ethers.parseEther("10");

      const balanceC_before = await tokenC.balanceOf(whitelistedUser.address);
      const balanceA_before = await tokenA.balanceOf(whitelistedUser.address);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address", "uint24", "address"],
        [tokenC.target, 3000, tokenB.target, 3000, tokenA.target]
      );

      await swapRouter.connect(whitelistedUser).exactInput({
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: amountIn,
        amountOutMinimum: 0,
      });

      const balanceC_after = await tokenC.balanceOf(whitelistedUser.address);
      const balanceA_after = await tokenA.balanceOf(whitelistedUser.address);

      expect(balanceC_before - balanceC_after).to.equal(amountIn);
      expect(balanceA_after).to.be.gt(balanceA_before);
    });

    it("exactInput should revert when amountOutMinimum is too high (slippage protection)", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB, tokenC } =
        await loadFixture(deployMultiHopFixture);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address", "uint24", "address"],
        [tokenA.target, 3000, tokenB.target, 3000, tokenC.target]
      );

      // Expect ~9.94 output for 10 input through 2 pools (0.3% fee each)
      // Set minimum much higher to trigger slippage revert
      await expect(swapRouter.connect(whitelistedUser).exactInput({
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: ethers.parseEther("100"), // way too high
      })).to.be.revertedWith("Too little received");
    });

    it("exactOutput A -> B -> C with balance verification", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB, tokenC } =
        await loadFixture(deployMultiHopFixture);

      const amountOut = ethers.parseEther("5");

      const balanceA_before = await tokenA.balanceOf(whitelistedUser.address);
      const balanceC_before = await tokenC.balanceOf(whitelistedUser.address);

      // exactOutput path is reversed: output token first
      const path = ethers.solidityPacked(
        ["address", "uint24", "address", "uint24", "address"],
        [tokenC.target, 3000, tokenB.target, 3000, tokenA.target]
      );

      await swapRouter.connect(whitelistedUser).exactOutput({
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountOut: amountOut,
        amountInMaximum: ethers.parseEther("100"),
      });

      const balanceA_after = await tokenA.balanceOf(whitelistedUser.address);
      const balanceC_after = await tokenC.balanceOf(whitelistedUser.address);

      // tokenC increased by exact amountOut
      expect(balanceC_after - balanceC_before).to.equal(amountOut);
      // tokenA decreased (paid input)
      expect(balanceA_after).to.be.lt(balanceA_before);
    });

    it("exactOutput C -> B -> A reverse direction with balance verification", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB, tokenC } =
        await loadFixture(deployMultiHopFixture);

      const amountOut = ethers.parseEther("5");

      const balanceA_before = await tokenA.balanceOf(whitelistedUser.address);
      const balanceC_before = await tokenC.balanceOf(whitelistedUser.address);

      // exactOutput reverse: want tokenA out, pay tokenC in
      // path is reversed: output first → tokenA -> tokenB -> tokenC
      const path = ethers.solidityPacked(
        ["address", "uint24", "address", "uint24", "address"],
        [tokenA.target, 3000, tokenB.target, 3000, tokenC.target]
      );

      await swapRouter.connect(whitelistedUser).exactOutput({
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountOut: amountOut,
        amountInMaximum: ethers.parseEther("100"),
      });

      const balanceA_after = await tokenA.balanceOf(whitelistedUser.address);
      const balanceC_after = await tokenC.balanceOf(whitelistedUser.address);

      // tokenA increased by exact amountOut
      expect(balanceA_after - balanceA_before).to.equal(amountOut);
      // tokenC decreased (paid input)
      expect(balanceC_after).to.be.lt(balanceC_before);
    });

    it("exactOutput should revert when amountInMaximum is too low (slippage protection)", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB, tokenC } =
        await loadFixture(deployMultiHopFixture);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address", "uint24", "address"],
        [tokenC.target, 3000, tokenB.target, 3000, tokenA.target]
      );

      // Set max input way too low — should revert
      await expect(swapRouter.connect(whitelistedUser).exactOutput({
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("5"),
        amountInMaximum: ethers.parseEther("0.001"), // way too low
      })).to.be.revertedWith("Too much requested");
    });

    it("exactInput multi-hop emits Transfer events per hop", async function () {
      const { swapRouter, whitelistedUser, tokenA, tokenB, tokenC, fusangFactory } =
        await loadFixture(deployMultiHopFixture);

      const amountIn = ethers.parseEther("10");

      const path = ethers.solidityPacked(
        ["address", "uint24", "address", "uint24", "address"],
        [tokenA.target, 3000, tokenB.target, 3000, tokenC.target]
      );

      // Should emit Transfer events for each hop
      await expect(swapRouter.connect(whitelistedUser).exactInput({
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: amountIn,
        amountOutMinimum: 0,
      }))
        // Hop 1: tokenA from user to pool A-B
        .to.emit(tokenA, "Transfer")
        // Hop 2: tokenC from pool B-C to user
        .to.emit(tokenC, "Transfer");
    });
  });

  describe("Insufficient liquidity handling", function () {
    async function deployLimitedLiquidityFixture() {
      const [admin, whitelistedUser] = await ethers.getSigners();

      // Deploy WalletList contract
      const WalletListFactory = await ethers.getContractFactory("WalletList");
      const walletList = await WalletListFactory.deploy();

      // Deploy WETH9 contract
      const WETH9Factory = await ethers.getContractFactory(
        WETH9.abi,
        WETH9.bytecode
      );
      const weth9 = await WETH9Factory.deploy();

      // Deploy test tokens
      const TokenFactory = await ethers.getContractFactory(
        "contracts/core/test/TestERC20.sol:TestERC20"
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

      // Configure WalletList (WHITELIST→MEMBER already set in constructor)
      await walletList.addToList(MEMBER, DEFAULT_ADMIN_ROLE, admin.address);
      await walletList.addToList(WHITELIST, MEMBER, whitelistedUser.address);
      await walletList.addToList(WHITELIST, MEMBER, admin.address);

      // Deploy FusangSwapRouter
      const FusangSwapRouter = await ethers.getContractFactory("FusangSwapRouter");
      const swapRouter = await FusangSwapRouter.deploy(
        fusangFactory.target,
        weth9.target,
        fusangPoolState.target
      );

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

      // Add contracts to whitelist and allowlist
      await walletList.addToList(WHITELIST, MEMBER, positionManager.target);
      await walletList.addToList(WHITELIST, MEMBER, swapRouter.target);
      await fusangAllowList.setAllowed(positionManager.target, true);
      await fusangAllowList.setAllowed(swapRouter.target, true);
      await fusangAllowList.setAllowed(admin.address, true);
      await fusangAllowList.setAllowed(whitelistedUser.address, true);

      // Sort tokens properly
      const [token0, token1] = tokenA.target.toLowerCase() < tokenB.target.toLowerCase()
        ? [tokenA, tokenB]
        : [tokenB, tokenA];

      // Approve tokens
      await token0.approve(swapRouter.target, ethers.MaxUint256);
      await token0.approve(positionManager.target, ethers.MaxUint256);
      await token1.approve(swapRouter.target, ethers.MaxUint256);
      await token1.approve(positionManager.target, ethers.MaxUint256);
      await token0.connect(whitelistedUser).approve(swapRouter.target, ethers.MaxUint256);
      await token1.connect(whitelistedUser).approve(swapRouter.target, ethers.MaxUint256);
      await token0.transfer(whitelistedUser.address, ethers.parseEther("100000"));
      await token1.transfer(whitelistedUser.address, ethers.parseEther("100000"));

      // Create pool with token0 < token1
      await fusangFactory.createPool(token0.target, token1.target, 3000);
      await positionManager.createAndInitializePoolIfNecessary(
        token0.target,
        token1.target,
        3000,
        encodePriceSqrt(1, 1)
      );

      // Provide VERY LIMITED liquidity - only 10 tokens in a narrow tick range
      await positionManager.connect(admin).mint({
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: -60, // Very narrow range
        tickUpper: 60,
        amount0Desired: ethers.parseEther("10"),
        amount1Desired: ethers.parseEther("10"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
      });

      return {
        admin,
        whitelistedUser,
        token0,
        token1,
        swapRouter,
        positionManager,
      };
    }

    it("exactOutputSingle should revert when pool cannot provide exact output amount", async function () {
      const { swapRouter, whitelistedUser, token0, token1 } =
        await loadFixture(deployLimitedLiquidityFixture);

      // Try to swap more than the pool has liquidity for
      // The pool only has ~10 tokens of liquidity in a narrow range
      // Request 100 tokens which exceeds available liquidity
      const params = {
        tokenIn: token0.target,
        tokenOut: token1.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("100"), // Way more than pool can provide
        amountInMaximum: ethers.parseEther("10000"),
        sqrtPriceLimitX96: 0, // This is key - sqrtPriceLimitX96 == 0
      };

      // This should revert because amountOutReceived != amountOut
      await expect(swapRouter.connect(whitelistedUser).exactOutputSingle(params))
        .to.be.reverted;
    });
  });

  describe("Restricted Sweep/Refund Overrides (V-001)", function () {
    describe("sweepToken", function () {
      it("Should allow whitelisted caller to sweep tokens to whitelisted recipient", async function () {
        const { swapRouter, admin, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        // Send some tokens directly to the router to simulate dust
        await tokenA.transfer(swapRouter.target, ethers.parseEther("10"));

        const balanceBefore = await tokenA.balanceOf(whitelistedUser.address);
        await swapRouter.connect(admin).sweepToken(tokenA.target, 0, whitelistedUser.address);
        const balanceAfter = await tokenA.balanceOf(whitelistedUser.address);

        expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("10"));
      });

      it("Should revert for non-whitelisted caller", async function () {
        const { swapRouter, nonWhitelistedUser, tokenA } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(nonWhitelistedUser).sweepToken(tokenA.target, 0, nonWhitelistedUser.address)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for non-whitelisted recipient", async function () {
        const { swapRouter, admin, nonWhitelistedUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).sweepToken(tokenA.target, 0, nonWhitelistedUser.address)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted caller", async function () {
        const { swapRouter, blacklistedUser, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(blacklistedUser).sweepToken(tokenA.target, 0, whitelistedUser.address)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for frozen caller", async function () {
        const { swapRouter, frozenUser, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(frozenUser).sweepToken(tokenA.target, 0, whitelistedUser.address)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted recipient", async function () {
        const { swapRouter, admin, blacklistedUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).sweepToken(tokenA.target, 0, blacklistedUser.address)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for frozen recipient", async function () {
        const { swapRouter, admin, frozenUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).sweepToken(tokenA.target, 0, frozenUser.address)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert when balance is below amountMinimum", async function () {
        const { swapRouter, admin, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(admin).sweepToken(tokenA.target, ethers.parseEther("1"), whitelistedUser.address)
        ).to.be.revertedWith("Insufficient token");
      });

      it("Should succeed with zero balance when amountMinimum is 0", async function () {
        const { swapRouter, admin, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(admin).sweepToken(tokenA.target, 0, whitelistedUser.address)
        ).to.not.be.reverted;
      });

      it("Should revert sweeping to address(0)", async function () {
        const { swapRouter, admin, tokenA } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(admin).sweepToken(tokenA.target, 0, ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should allow sweeping to contract itself (skips recipient check)", async function () {
        const { swapRouter, admin, tokenA } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(admin).sweepToken(tokenA.target, 0, swapRouter.target)
        ).to.not.be.reverted;
      });
    });

    describe("unwrapWETH9", function () {
      it("Should allow whitelisted caller to unwrap WETH9 to whitelisted recipient", async function () {
        const { swapRouter, admin, whitelistedUser, weth9 } = await loadFixture(deployFixture);

        // Deposit ETH to WETH9 and send to router
        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("1"));

        const balanceBefore = await ethers.provider.getBalance(whitelistedUser.address);
        await swapRouter.connect(admin).unwrapWETH9(0, whitelistedUser.address);
        const balanceAfter = await ethers.provider.getBalance(whitelistedUser.address);

        expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("1"));
      });

      it("Should revert for non-whitelisted caller", async function () {
        const { swapRouter, nonWhitelistedUser } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(nonWhitelistedUser).unwrapWETH9(0, nonWhitelistedUser.address)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for non-whitelisted recipient", async function () {
        const { swapRouter, admin, nonWhitelistedUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).unwrapWETH9(0, nonWhitelistedUser.address)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted caller", async function () {
        const { swapRouter, blacklistedUser, whitelistedUser } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(blacklistedUser).unwrapWETH9(0, whitelistedUser.address)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for frozen caller", async function () {
        const { swapRouter, frozenUser, whitelistedUser } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(frozenUser).unwrapWETH9(0, whitelistedUser.address)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted recipient", async function () {
        const { swapRouter, admin, blacklistedUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).unwrapWETH9(0, blacklistedUser.address)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for frozen recipient", async function () {
        const { swapRouter, admin, frozenUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).unwrapWETH9(0, frozenUser.address)
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert when WETH9 balance is below amountMinimum", async function () {
        const { swapRouter, admin, whitelistedUser } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(admin).unwrapWETH9(ethers.parseEther("1"), whitelistedUser.address)
        ).to.be.revertedWith("Insufficient WETH9");
      });

      it("Should succeed with zero WETH9 balance when amountMinimum is 0", async function () {
        const { swapRouter, admin, whitelistedUser } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(admin).unwrapWETH9(0, whitelistedUser.address)
        ).to.not.be.reverted;
      });
    });

    describe("refundETH", function () {
      it("Should allow whitelisted caller to refund ETH", async function () {
        const { swapRouter, admin } = await loadFixture(deployFixture);

        // Send ETH as msg.value with refundETH call (receive() only accepts from WETH9)
        const balanceBefore = await ethers.provider.getBalance(admin.address);
        const tx = await swapRouter.connect(admin).refundETH({ value: ethers.parseEther("1") });
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;
        const balanceAfter = await ethers.provider.getBalance(admin.address);

        // ETH sent as msg.value is refunded back, net effect is only gas cost
        expect(balanceBefore - balanceAfter).to.equal(gasUsed);
      });

      it("Should revert for non-whitelisted caller", async function () {
        const { swapRouter, nonWhitelistedUser } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(nonWhitelistedUser).refundETH()
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted caller", async function () {
        const { swapRouter, blacklistedUser } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(blacklistedUser).refundETH()
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for frozen caller", async function () {
        const { swapRouter, frozenUser } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(frozenUser).refundETH()
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should succeed with zero ETH balance (no-op)", async function () {
        const { swapRouter, admin } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(admin).refundETH()
        ).to.not.be.reverted;
      });
    });

    describe("sweepTokenWithFee", function () {
      it("Should allow whitelisted caller to sweep tokens with fee", async function () {
        const { swapRouter, admin, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(swapRouter.target, ethers.parseEther("100"));

        const recipientBefore = await tokenA.balanceOf(whitelistedUser.address);
        const feeRecipientBefore = await tokenA.balanceOf(admin.address);

        // feeBips = 50 means 50/10000 = 0.5%
        await swapRouter.connect(admin).sweepTokenWithFee(
          tokenA.target, 0, whitelistedUser.address, 50, admin.address
        );

        const recipientAfter = await tokenA.balanceOf(whitelistedUser.address);
        const feeRecipientAfter = await tokenA.balanceOf(admin.address);

        // fee = 100 * 50 / 10000 = 0.5 ETH
        const feeAmount = ethers.parseEther("100") * 50n / 10000n;
        expect(recipientAfter - recipientBefore).to.equal(ethers.parseEther("100") - feeAmount);
        expect(feeRecipientAfter - feeRecipientBefore).to.equal(feeAmount);
      });

      it("Should revert for non-whitelisted caller", async function () {
        const { swapRouter, nonWhitelistedUser, admin, tokenA } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(nonWhitelistedUser).sweepTokenWithFee(
            tokenA.target, 0, admin.address, 50, admin.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for non-whitelisted recipient", async function () {
        const { swapRouter, admin, nonWhitelistedUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).sweepTokenWithFee(
            tokenA.target, 0, nonWhitelistedUser.address, 50, admin.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for non-whitelisted fee recipient", async function () {
        const { swapRouter, admin, whitelistedUser, nonWhitelistedUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).sweepTokenWithFee(
            tokenA.target, 0, whitelistedUser.address, 50, nonWhitelistedUser.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted caller", async function () {
        const { swapRouter, blacklistedUser, admin, tokenA } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(blacklistedUser).sweepTokenWithFee(
            tokenA.target, 0, admin.address, 50, admin.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for frozen caller", async function () {
        const { swapRouter, frozenUser, admin, tokenA } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(frozenUser).sweepTokenWithFee(
            tokenA.target, 0, admin.address, 50, admin.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted recipient", async function () {
        const { swapRouter, admin, blacklistedUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).sweepTokenWithFee(
            tokenA.target, 0, blacklistedUser.address, 50, admin.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for frozen recipient", async function () {
        const { swapRouter, admin, frozenUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).sweepTokenWithFee(
            tokenA.target, 0, frozenUser.address, 50, admin.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted fee recipient", async function () {
        const { swapRouter, admin, whitelistedUser, blacklistedUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).sweepTokenWithFee(
            tokenA.target, 0, whitelistedUser.address, 50, blacklistedUser.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for frozen fee recipient", async function () {
        const { swapRouter, admin, whitelistedUser, frozenUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).sweepTokenWithFee(
            tokenA.target, 0, whitelistedUser.address, 50, frozenUser.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert when feeBips is 0", async function () {
        const { swapRouter, admin, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).sweepTokenWithFee(
            tokenA.target, 0, whitelistedUser.address, 0, admin.address
          )
        ).to.be.reverted;
      });

      it("Should revert when feeBips exceeds 100", async function () {
        const { swapRouter, admin, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        await tokenA.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).sweepTokenWithFee(
            tokenA.target, 0, whitelistedUser.address, 101, admin.address
          )
        ).to.be.reverted;
      });

      it("Should revert when balance is below amountMinimum", async function () {
        const { swapRouter, admin, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(admin).sweepTokenWithFee(
            tokenA.target, ethers.parseEther("1"), whitelistedUser.address, 50, admin.address
          )
        ).to.be.revertedWith("Insufficient token");
      });

      it("Should succeed with zero balance when amountMinimum is 0", async function () {
        const { swapRouter, admin, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(admin).sweepTokenWithFee(
            tokenA.target, 0, whitelistedUser.address, 50, admin.address
          )
        ).to.not.be.reverted;
      });

      it("Should skip fee transfer when feeAmount rounds to 0 (tiny balance)", async function () {
        const { swapRouter, admin, whitelistedUser, tokenA } = await loadFixture(deployFixture);

        // Send 1 wei of tokens — with feeBips=1, feeAmount = 1*1/10000 = 0
        await tokenA.transfer(swapRouter.target, 1);

        const recipientBefore = await tokenA.balanceOf(whitelistedUser.address);
        await swapRouter.connect(admin).sweepTokenWithFee(
          tokenA.target, 0, whitelistedUser.address, 1, admin.address
        );
        const recipientAfter = await tokenA.balanceOf(whitelistedUser.address);

        // All 1 wei goes to recipient, 0 fee
        expect(recipientAfter - recipientBefore).to.equal(1);
      });
    });

    describe("unwrapWETH9WithFee", function () {
      it("Should allow whitelisted caller to unwrap WETH9 with fee", async function () {
        const { swapRouter, admin, whitelistedUser, weth9 } = await loadFixture(deployFixture);

        // Deposit and send WETH9 to router
        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("10") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("10"));

        const recipientBefore = await ethers.provider.getBalance(whitelistedUser.address);
        const feeRecipientBefore = await ethers.provider.getBalance(admin.address);

        // feeBips = 100 means 100/10000 = 1%
        const tx = await swapRouter.connect(admin).unwrapWETH9WithFee(
          0, whitelistedUser.address, 100, admin.address
        );
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;

        const recipientAfter = await ethers.provider.getBalance(whitelistedUser.address);
        const feeRecipientAfter = await ethers.provider.getBalance(admin.address);

        // fee = 10 * 100 / 10000 = 0.1 ETH
        const feeAmount = ethers.parseEther("10") * 100n / 10000n;
        expect(recipientAfter - recipientBefore).to.equal(ethers.parseEther("10") - feeAmount);
        // Admin receives fee but pays gas
        expect(feeRecipientAfter + gasUsed - feeRecipientBefore).to.equal(feeAmount);
      });

      it("Should revert for non-whitelisted caller", async function () {
        const { swapRouter, nonWhitelistedUser, admin } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(nonWhitelistedUser).unwrapWETH9WithFee(
            0, admin.address, 50, admin.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for non-whitelisted recipient", async function () {
        const { swapRouter, admin, nonWhitelistedUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).unwrapWETH9WithFee(
            0, nonWhitelistedUser.address, 50, admin.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for non-whitelisted fee recipient", async function () {
        const { swapRouter, admin, whitelistedUser, nonWhitelistedUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).unwrapWETH9WithFee(
            0, whitelistedUser.address, 50, nonWhitelistedUser.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted caller", async function () {
        const { swapRouter, blacklistedUser, admin } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(blacklistedUser).unwrapWETH9WithFee(
            0, admin.address, 50, admin.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for frozen caller", async function () {
        const { swapRouter, frozenUser, admin } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(frozenUser).unwrapWETH9WithFee(
            0, admin.address, 50, admin.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted recipient", async function () {
        const { swapRouter, admin, blacklistedUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).unwrapWETH9WithFee(
            0, blacklistedUser.address, 50, admin.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for frozen recipient", async function () {
        const { swapRouter, admin, frozenUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).unwrapWETH9WithFee(
            0, frozenUser.address, 50, admin.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for blacklisted fee recipient", async function () {
        const { swapRouter, admin, whitelistedUser, blacklistedUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).unwrapWETH9WithFee(
            0, whitelistedUser.address, 50, blacklistedUser.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert for frozen fee recipient", async function () {
        const { swapRouter, admin, whitelistedUser, frozenUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).unwrapWETH9WithFee(
            0, whitelistedUser.address, 50, frozenUser.address
          )
        ).to.be.revertedWithCustomError(swapRouter, "NotAllowedToSwap");
      });

      it("Should revert when feeBips is 0", async function () {
        const { swapRouter, admin, whitelistedUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).unwrapWETH9WithFee(
            0, whitelistedUser.address, 0, admin.address
          )
        ).to.be.reverted;
      });

      it("Should revert when feeBips exceeds 100", async function () {
        const { swapRouter, admin, whitelistedUser, weth9 } = await loadFixture(deployFixture);

        await admin.sendTransaction({ to: weth9.target, value: ethers.parseEther("1") });
        await weth9.transfer(swapRouter.target, ethers.parseEther("1"));

        await expect(
          swapRouter.connect(admin).unwrapWETH9WithFee(
            0, whitelistedUser.address, 101, admin.address
          )
        ).to.be.reverted;
      });

      it("Should revert when WETH9 balance is below amountMinimum", async function () {
        const { swapRouter, admin, whitelistedUser } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(admin).unwrapWETH9WithFee(
            ethers.parseEther("1"), whitelistedUser.address, 50, admin.address
          )
        ).to.be.revertedWith("Insufficient WETH9");
      });

      it("Should succeed with zero WETH9 balance when amountMinimum is 0", async function () {
        const { swapRouter, admin, whitelistedUser } = await loadFixture(deployFixture);

        await expect(
          swapRouter.connect(admin).unwrapWETH9WithFee(
            0, whitelistedUser.address, 50, admin.address
          )
        ).to.not.be.reverted;
      });

      it("Should skip fee transfer when feeAmount rounds to 0 (tiny balance)", async function () {
        const { swapRouter, admin, whitelistedUser, weth9 } = await loadFixture(deployFixture);

        // Deposit 1 wei of WETH9 and send to router — with feeBips=1, feeAmount = 1*1/10000 = 0
        await admin.sendTransaction({ to: weth9.target, value: 1 });
        await weth9.transfer(swapRouter.target, 1);

        const recipientBefore = await ethers.provider.getBalance(whitelistedUser.address);
        await swapRouter.connect(admin).unwrapWETH9WithFee(
          0, whitelistedUser.address, 1, admin.address
        );
        const recipientAfter = await ethers.provider.getBalance(whitelistedUser.address);

        // All 1 wei goes to recipient, 0 fee
        expect(recipientAfter - recipientBefore).to.equal(1);
      });
    });
  });
});
