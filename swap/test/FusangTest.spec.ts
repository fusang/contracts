// @ts-nocheck - Hardhat contracts use dynamic methods not typed in BaseContract
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import BigNumber from "bignumber.js";

import {
  abi as UniswapV3PoolABI,
  bytecode as fusangPairBytecode,
} from "../artifacts/contracts/core/UniswapV3Pool.sol/UniswapV3Pool.json";
import WETH9 from "./contracts/WETH9.json";

import { encodePriceSqrt } from "./shared/encodePriceSqrt";
import { getMaxTick, getMinTick } from "./shared/ticks";

const FROZENLIST = ethers.keccak256(ethers.toUtf8Bytes("FROZENLIST"));
const MEMBER = ethers.keccak256(ethers.toUtf8Bytes("MEMBER"));

const WHITELIST = ethers.keccak256(ethers.toUtf8Bytes("WHITELIST"));
const BLACKLIST = ethers.keccak256(ethers.toUtf8Bytes("BLACKLIST"));
const DEFAULT_ADMIN_ROLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("FusangSwapRouter", function () {
  async function deploy() {
    const [admin, whitelistedUser, nonWhitelistedUser, whitelistedUser2] =
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
    const tokenA = await TokenFactory.deploy(ethers.parseEther("1000000"));
    const tokenB = await TokenFactory.deploy(ethers.parseEther("1000000"));

    // Deploy FusangAllowList contract (uses walletList for admin)
    const FusangAllowList = await ethers.getContractFactory("FusangAllowList");
    const fusangAllowList = await FusangAllowList.deploy(walletList.target);

    // Deploy FusangFactory contract with allowList
    const FusangFactory = await ethers.getContractFactory("FusangFactory");
    const fusangFactory = await FusangFactory.deploy(fusangAllowList.target);

    // Deploy FusangPoolState
    const FusangPoolState = await ethers.getContractFactory("FusangPoolState");
    const fusangPoolState = await FusangPoolState.deploy(fusangFactory.target);

    // Whitelist configuration
    await walletList.setRoleManageList(BLACKLIST, DEFAULT_ADMIN_ROLE, true);
    await walletList.setRoleManageList(FROZENLIST, DEFAULT_ADMIN_ROLE, true);
    await walletList.addToList(MEMBER, DEFAULT_ADMIN_ROLE, admin.address);
    await walletList.addToList(
      MEMBER,
      DEFAULT_ADMIN_ROLE,
      fusangFactory.target
    );
    await walletList.addToList(WHITELIST, MEMBER, whitelistedUser.address);
    await walletList.addToList(WHITELIST, MEMBER, admin.address);
    await walletList.addToList(WHITELIST, MEMBER, whitelistedUser2.address);

    // Deploy FusangSwapRouter
    const FusangSwapRouter = await ethers.getContractFactory(
      "FusangSwapRouter"
    );
    const swapRouter = await FusangSwapRouter.deploy(
      fusangFactory.target,
      weth9.target,
      fusangPoolState.target
    );

    // Deploy NFTDescriptor library
    const NFTDescriptorFactory = await ethers.getContractFactory(
      "NFTDescriptor"
    );
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
    await walletList.addToList(WHITELIST, MEMBER, positionManager.target);
    await walletList.addToList(WHITELIST, MEMBER, swapRouter.target);

    // Add addresses to allowlist for pool access
    await fusangAllowList.setAllowed(positionManager.target, true);
    await fusangAllowList.setAllowed(swapRouter.target, true);

    // Approve tokens
    const tokens = [tokenA, tokenB];
    for (const token of tokens) {
      await token.approve(swapRouter.target, ethers.MaxUint256);
      await token.approve(positionManager.target, ethers.MaxUint256);
      await token
        .connect(whitelistedUser)
        .approve(swapRouter.target, ethers.MaxUint256);
      await token
        .connect(whitelistedUser)
        .approve(positionManager.target, ethers.MaxUint256);
      await token.transfer(
        whitelistedUser.address,
        ethers.parseEther("100000")
      );
      await token.transfer(
        nonWhitelistedUser.address,
        ethers.parseEther("100000")
      );
      await token
        .connect(nonWhitelistedUser)
        .approve(swapRouter.target, ethers.MaxUint256);
    }

    // Sort tokens properly (token0 < token1 required by PoolInitializer)
    const [token0, token1] = tokenA.target.toLowerCase() < tokenB.target.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

    // Create and initialize pool
    await fusangFactory.createPool(token0.target, token1.target, 3000);
    await positionManager.createAndInitializePoolIfNecessary(
      token0.target,
      token1.target,
      3000,
      encodePriceSqrt(1, 1)
    );

    const poolAddress = await fusangFactory.getPool(
      token0.target,
      token1.target,
      3000
    );

    const pool = await ethers.getContractAt(UniswapV3PoolABI, poolAddress);

    const data = await walletList.isAddressInList(WHITELIST, poolAddress);
    // Provide liquidity
    const tx = await positionManager.connect(admin).mint({
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

    const receipt = await tx.wait();
    const tokenId = receipt.logs[4].args[0];

    return {
      admin,
      whitelistedUser,
      whitelistedUser2,
      nonWhitelistedUser,
      tokenA,
      tokenB,
      token0, // sorted token0 (token0 < token1)
      token1, // sorted token1
      swapRouter,
      positionManager,
      walletList,
      tokenId,
      pool,
      fusangFactory,
      fusangAllowList,
      fusangPoolState,
    };
  }

  it("Should allow a whitelisted user to perform exactInputSingle swap", async function () {
    const { whitelistedUser, tokenA, tokenB, swapRouter } = await loadFixture(
      deploy
    );

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
    await swapRouter.connect(whitelistedUser).exactInputSingle(params);
  });

  it("Call Hash", async () => {
    const callHashFactory = await ethers.getContractFactory("CallHash");
    const callHash = await callHashFactory.deploy();
    const initHash = await callHash.getInitHash();
    const codeHash = ethers.keccak256(fusangPairBytecode);
    console.log("INIT_CODE_HASH", codeHash)
    expect(initHash).to.be.equal(codeHash)
  });

  // it("Should prevent a non-whitelisted user from performing exactInputSingle swap", async function () {
  //   const { nonWhitelistedUser, tokenA, tokenB, swapRouter } =
  //     await loadFixture(deploy);

  //   const params = {
  //     tokenIn: tokenA.target,
  //     tokenOut: tokenB.target,
  //     fee: 3000,
  //     recipient: nonWhitelistedUser.address,
  //     deadline: ethers.MaxUint256,
  //     amountIn: ethers.parseEther("10"),
  //     amountOutMinimum: 0,
  //     sqrtPriceLimitX96: 0,
  //   };

  //   await expect(
  //     swapRouter.connect(nonWhitelistedUser).exactInputSingle(params)
  //   ).to.be.revertedWith("Not whitelisted");
  // });
  // Additional test cases for other functions
  it("Should allow a whitelisted user to perform exactOutputSingle swap", async function () {
    const { whitelistedUser, tokenA, tokenB, swapRouter } = await loadFixture(
      deploy
    );

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
    swapRouter.connect(whitelistedUser).exactOutputSingle(params);
  });

  // it("Should prevent a non-whitelisted user from performing exactOutputSingle swap", async function () {
  //   const { nonWhitelistedUser, tokenA, tokenB, swapRouter } =
  //     await loadFixture(deploy);

  //   const params = {
  //     tokenIn: tokenA.target,
  //     tokenOut: tokenB.target,
  //     fee: 3000,
  //     recipient: nonWhitelistedUser.address,
  //     deadline: ethers.MaxUint256,
  //     amountOut: ethers.parseEther("5"),
  //     amountInMaximum: ethers.parseEther("10"),
  //     sqrtPriceLimitX96: 0,
  //   };

  //   await expect(
  //     swapRouter.connect(nonWhitelistedUser).exactOutputSingle(params)
  //   ).to.be.revertedWith("Not whitelisted");
  // });

  it("Should allow a whitelisted user to perform exactInput swap", async function () {
    const { whitelistedUser, tokenA, tokenB, swapRouter } = await loadFixture(
      deploy
    );

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
    await swapRouter.connect(whitelistedUser).exactInput(params);
  });

  // it("Should prevent a non-whitelisted user from performing exactInput swap", async function () {
  //   const { nonWhitelistedUser, tokenA, tokenB, swapRouter } =
  //     await loadFixture(deploy);

  //   const path = ethers.solidityPacked(
  //     ["address", "uint24", "address"],
  //     [tokenA.target, 3000, tokenB.target]
  //   );

  //   const params = {
  //     path: path,
  //     recipient: nonWhitelistedUser.address,
  //     deadline: ethers.MaxUint256,
  //     amountIn: ethers.parseEther("10"),
  //     amountOutMinimum: 0,
  //   };

  //   await expect(
  //     swapRouter.connect(nonWhitelistedUser).exactInput(params)
  //   ).to.be.revertedWith("Not whitelisted");
  // });

  it("Should allow a whitelisted user to perform exactOutput swap", async function () {
    const { whitelistedUser, tokenA, tokenB, swapRouter } = await loadFixture(
      deploy
    );

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
    await swapRouter.connect(whitelistedUser).exactOutput(params);
  });

  // it("Should prevent a non-whitelisted user from performing exactOutput swap", async function () {
  //   const { nonWhitelistedUser, tokenA, tokenB, swapRouter } =
  //     await loadFixture(deploy);

  //   const path = ethers.solidityPacked(
  //     ["address", "uint24", "address"],
  //     [tokenB.target, 3000, tokenA.target]
  //   );

  //   const params = {
  //     path: path,
  //     recipient: nonWhitelistedUser.address,
  //     deadline: ethers.MaxUint256,
  //     amountOut: ethers.parseEther("5"),
  //     amountInMaximum: ethers.parseEther("10"),
  //   };
  //   await expect(
  //     swapRouter.connect(nonWhitelistedUser).exactOutput(params)
  //   ).to.be.revertedWith("Not whitelisted");
  // });

  it("Should revert if deadline has passed for exactInputSingle", async function () {
    const { whitelistedUser, tokenA, tokenB, swapRouter } = await loadFixture(
      deploy
    );

    const params = {
      tokenIn: tokenA.target,
      tokenOut: tokenB.target,
      fee: 3000,
      recipient: whitelistedUser.address,
      deadline: (await ethers.provider.getBlock("latest")).timestamp - 1, // Deadline in the past
      amountIn: ethers.parseEther("10"),
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    };

    await expect(
      swapRouter.connect(whitelistedUser).exactInputSingle(params)
    ).to.be.revertedWith("Transaction too old");
  });

  it("Should allow transaction if deadline is in the future for exactInputSingle", async function () {
    const { whitelistedUser, tokenA, tokenB, swapRouter } = await loadFixture(
      deploy
    );

    const params = {
      tokenIn: tokenA.target,
      tokenOut: tokenB.target,
      fee: 3000,
      recipient: whitelistedUser.address,
      deadline: (await ethers.provider.getBlock("latest")).timestamp + 3600, // Deadline in the future
      amountIn: ethers.parseEther("10"),
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    };

    await swapRouter.connect(whitelistedUser).exactInputSingle(params);
  });

  it("Should revert if deadline has passed for exactOutputSingle", async function () {
    const { whitelistedUser, tokenA, tokenB, swapRouter } = await loadFixture(
      deploy
    );

    const params = {
      tokenIn: tokenA.target,
      tokenOut: tokenB.target,
      fee: 3000,
      recipient: whitelistedUser.address,
      deadline: (await ethers.provider.getBlock("latest")).timestamp - 1, // Deadline in the past
      amountOut: ethers.parseEther("5"),
      amountInMaximum: ethers.parseEther("10"),
      sqrtPriceLimitX96: 0,
    };

    await expect(
      swapRouter.connect(whitelistedUser).exactOutputSingle(params)
    ).to.be.revertedWith("Transaction too old");
  });

  it("Should allow transaction if deadline is in the future for exactOutputSingle", async function () {
    const { whitelistedUser, tokenA, tokenB, swapRouter } = await loadFixture(
      deploy
    );

    const params = {
      tokenIn: tokenA.target,
      tokenOut: tokenB.target,
      fee: 3000,
      recipient: whitelistedUser.address,
      deadline: (await ethers.provider.getBlock("latest")).timestamp + 3600, // Deadline in the future
      amountOut: ethers.parseEther("5"),
      amountInMaximum: ethers.parseEther("10"),
      sqrtPriceLimitX96: 0,
    };

    await swapRouter.connect(whitelistedUser).exactOutputSingle(params);
  });

  it("Should revert if deadline has passed for exactInput", async function () {
    const { whitelistedUser, tokenA, tokenB, swapRouter } = await loadFixture(
      deploy
    );

    const path = ethers.solidityPacked(
      ["address", "uint24", "address"],
      [tokenA.target, 3000, tokenB.target]
    );

    const params = {
      path: path,
      recipient: whitelistedUser.address,
      deadline: (await ethers.provider.getBlock("latest")).timestamp - 1, // Deadline in the past
      amountIn: ethers.parseEther("10"),
      amountOutMinimum: 0,
    };

    await expect(
      swapRouter.connect(whitelistedUser).exactInput(params)
    ).to.be.revertedWith("Transaction too old");
  });

  it("Should allow transaction if deadline is in the future for exactInput", async function () {
    const { whitelistedUser, tokenA, tokenB, swapRouter } = await loadFixture(
      deploy
    );

    const path = ethers.solidityPacked(
      ["address", "uint24", "address"],
      [tokenA.target, 3000, tokenB.target]
    );

    const params = {
      path: path,
      recipient: whitelistedUser.address,
      deadline: (await ethers.provider.getBlock("latest")).timestamp + 3600, // Deadline in the future
      amountIn: ethers.parseEther("10"),
      amountOutMinimum: 0,
    };

    await swapRouter.connect(whitelistedUser).exactInput(params);
  });

  it("Should revert if deadline has passed for exactOutput", async function () {
    const { whitelistedUser, tokenA, tokenB, swapRouter } = await loadFixture(
      deploy
    );

    const path = ethers.solidityPacked(
      ["address", "uint24", "address"],
      [tokenB.target, 3000, tokenA.target]
    );

    const params = {
      path: path,
      recipient: whitelistedUser.address,
      deadline: (await ethers.provider.getBlock("latest")).timestamp - 1, // Deadline in the past
      amountOut: ethers.parseEther("5"),
      amountInMaximum: ethers.parseEther("10"),
    };

    await expect(
      swapRouter.connect(whitelistedUser).exactOutput(params)
    ).to.be.revertedWith("Transaction too old");
  });

  it("Should allow transaction if deadline is in the future for exactOutput", async function () {
    const { whitelistedUser, tokenA, tokenB, swapRouter } = await loadFixture(
      deploy
    );

    const path = ethers.solidityPacked(
      ["address", "uint24", "address"],
      [tokenB.target, 3000, tokenA.target]
    );

    const params = {
      path: path,
      recipient: whitelistedUser.address,
      deadline: (await ethers.provider.getBlock("latest")).timestamp + 3600, // Deadline in the future
      amountOut: ethers.parseEther("5"),
      amountInMaximum: ethers.parseEther("10"),
    };

    await swapRouter.connect(whitelistedUser).exactOutput(params);
  });

  // it("Should prevent a non-whitelisted user from mint", async function () {
  //   const { nonWhitelistedUser, positionManager, tokenA, tokenB, tokenId } =
  //     await loadFixture(deploy);

  //   const mintParams = {
  //     token0: tokenA.target,
  //     token1: tokenB.target,
  //     fee: 3000,
  //     tickLower: getMinTick(60),
  //     tickUpper: getMaxTick(60),
  //     amount0Desired: ethers.parseEther("10000"),
  //     amount1Desired: ethers.parseEther("10000"),
  //     amount0Min: 0,
  //     amount1Min: 0,
  //     recipient: nonWhitelistedUser.address,
  //     deadline: ethers.MaxUint256,
  //   };

  //   await expect(
  //     positionManager.connect(nonWhitelistedUser).mint(mintParams)
  //   ).to.be.revertedWith("Not whitelisted");
  // });

  it("Should allow a whitelisted user to increase liquidity", async function () {
    const { whitelistedUser, positionManager, tokenA, tokenB, tokenId } =
      await loadFixture(deploy);

    const increaseParams = {
      tokenId: tokenId,
      amount0Desired: ethers.parseEther("100"),
      amount1Desired: ethers.parseEther("100"),
      amount0Min: 0,
      amount1Min: 0,
      deadline: ethers.MaxUint256,
    };

    await positionManager
      .connect(whitelistedUser)
      .increaseLiquidity(increaseParams);
  });

  // it("Should prevent a non-whitelisted user from increasing liquidity", async function () {
  //   const { nonWhitelistedUser, positionManager, tokenA, tokenB, tokenId } =
  //     await loadFixture(deploy);

  //   const increaseParams = {
  //     tokenId: tokenId,
  //     amount0Desired: ethers.parseEther("100"),
  //     amount1Desired: ethers.parseEther("100"),
  //     amount0Min: 0,
  //     amount1Min: 0,
  //     deadline: ethers.MaxUint256,
  //   };

  //   await expect(
  //     positionManager
  //       .connect(nonWhitelistedUser)
  //       .increaseLiquidity(increaseParams)
  //   ).to.be.revertedWith("Not whitelisted");
  // });

  it("Should allow a whitelisted user to decrease liquidity", async function () {
    const { admin, positionManager, tokenId } = await loadFixture(deploy);

    const decreaseParams = {
      tokenId: tokenId,
      liquidity: 1,
      amount0Min: 0,
      amount1Min: 0,
      deadline: ethers.MaxUint256,
    };

    await positionManager.connect(admin).decreaseLiquidity(decreaseParams);
  });

  // it("Should prevent a non-whitelisted user from decreasing liquidity", async function () {
  //   const { nonWhitelistedUser, positionManager, tokenId } = await loadFixture(
  //     deploy
  //   );

  //   const decreaseParams = {
  //     tokenId: tokenId,
  //     liquidity: 1,
  //     amount0Min: 0,
  //     amount1Min: 0,
  //     deadline: ethers.MaxUint256,
  //   };

  //   await expect(
  //     positionManager
  //       .connect(nonWhitelistedUser)
  //       .decreaseLiquidity(decreaseParams)
  //   ).to.be.revertedWith("Not whitelisted");
  // });

  it("Should allow a whitelisted user to collect fees", async function () {
    const { admin, positionManager, tokenId } = await loadFixture(deploy);

    // Assume some fees have been accumulated
    const collectParams = {
      tokenId: tokenId,
      recipient: admin.address,
      amount0Max: 1,
      amount1Max: 1,
    };
    await positionManager.connect(admin).collect(collectParams);
  });

  // it("Should prevent a non-whitelisted user from collecting fees", async function () {
  //   const { nonWhitelistedUser, positionManager, tokenId } = await loadFixture(
  //     deploy
  //   );

  //   const collectParams = {
  //     tokenId: tokenId,
  //     recipient: nonWhitelistedUser.address,
  //     amount0Max: 1,
  //     amount1Max: 1,
  //   };

  //   await expect(
  //     positionManager.connect(nonWhitelistedUser).collect(collectParams)
  //   ).to.be.revertedWith("Not whitelisted");
  // });

  it("Should allow a whitelisted user to burn position", async function () {
    const { admin, positionManager, tokenId } = await loadFixture(deploy);

    // Decrease liquidity to zero before burning
    const position = await positionManager.positions(tokenId);

    const decreaseParams = {
      tokenId: tokenId,
      liquidity: position[7],
      amount0Min: 0,
      amount1Min: 0,
      deadline: ethers.MaxUint256,
    };

    await positionManager.connect(admin).decreaseLiquidity(decreaseParams);

    // Collect remaining tokens
    const collectParams = {
      tokenId: tokenId,
      recipient: admin.address,
      amount0Max: new BigNumber(
        "0xffffffffffffffffffffffffffffffff",
        16
      ).toString(),
      amount1Max: new BigNumber(
        "0xffffffffffffffffffffffffffffffff",
        16
      ).toString(),
    };

    await positionManager.connect(admin).collect(collectParams);

    // Burn the token
    await positionManager.connect(admin).burn(tokenId);
  });

  it("Should allow admin to remove position when pool is inactive", async function () {
    const { admin, positionManager, tokenId, pool, fusangPoolState } = await loadFixture(deploy);

    // Pause pool first (removePosition requires inactive pool)
    await fusangPoolState.connect(admin).pausePool(pool.target);

    // Call removePosition
    await positionManager.connect(admin).removePosition({tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256});
  });

  // Pool Closed Tests
  describe("Pool Closed Functionality", function () {
    it("Should not allow mint when pool is closed", async function () {
      const { admin, whitelistedUser, token0, token1, positionManager, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400; // 1 day ago
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      // Try to mint position after pool is closed
      const mintParams = {
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        recipient: whitelistedUser.address,
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Should revert when pool is closed
      await expect(positionManager.connect(whitelistedUser).mint(mintParams)).to
        .be.reverted;
    });

    it("Should not allow admin to mint when pool is closed (admin can only remove positions)", async function () {
      const { admin, token0, token1, positionManager, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400; // 1 day ago
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      // Admin should NOT be able to mint when pool is closed (different from paused)
      const mintParams = {
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        recipient: admin.address,
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Should revert even for admin (pool closed is different from paused)
      await expect(positionManager.connect(admin).mint(mintParams)).to.be
        .reverted;
    });

    it("Should allow decreaseLiquidity when pool is closed (closed != paused)", async function () {
      const { admin, whitelistedUser, token0, token1, positionManager, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Create a position first
      const mintParams = {
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        recipient: whitelistedUser.address,
        amount0Desired: ethers.parseEther("1000"),
        amount1Desired: ethers.parseEther("1000"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      const mintTx = await positionManager
        .connect(whitelistedUser)
        .mint(mintParams);
      const mintReceipt = await mintTx.wait();
      const userTokenId = mintReceipt.logs[4].args[0];

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      // Get position info
      const position = await positionManager.positions(userTokenId);

      // DecreaseLiquidity IS allowed when pool is closed (only paused blocks it)
      const decreaseParams = {
        tokenId: userTokenId,
        liquidity: position[7], // All liquidity
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Should succeed when pool is closed (closed != paused)
      await positionManager
        .connect(whitelistedUser)
        .decreaseLiquidity(decreaseParams);
    });

    it("Should not allow exactInputSingle swap when pool is closed", async function () {
      const { admin, whitelistedUser, tokenA, tokenB, token0, token1, swapRouter, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      // Try to swap after pool is closed
      const swapParams = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      // Should revert when pool is closed
      await expect(
        swapRouter.connect(whitelistedUser).exactInputSingle(swapParams)
      ).to.be.reverted;
    });

    it("Should not allow admin to swap when pool is closed", async function () {
      const { admin, tokenA, tokenB, token0, token1, swapRouter, pool, fusangPoolState } = await loadFixture(
        deploy
      );

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      // Admin should NOT be able to swap when pool is closed (different from paused)
      const swapParams = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      // Should revert even for admin
      await expect(swapRouter.connect(admin).exactInputSingle(swapParams)).to.be
        .reverted;
    });

    it("Should not allow exactOutputSingle swap when pool is closed", async function () {
      const { admin, whitelistedUser, tokenA, tokenB, token0, token1, swapRouter, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      // Try exactOutputSingle after pool is closed
      const swapParams = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("5"),
        amountInMaximum: ethers.parseEther("10"),
        sqrtPriceLimitX96: 0,
      };

      // Should revert when pool is closed
      await expect(
        swapRouter.connect(whitelistedUser).exactOutputSingle(swapParams)
      ).to.be.reverted;
    });

    it("Should not allow exactInput swap when pool is closed", async function () {
      const { admin, whitelistedUser, tokenA, tokenB, token0, token1, swapRouter, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address"],
        [tokenA.target, 3000, tokenB.target]
      );

      // Try exactInput after pool is closed
      const swapParams = {
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
      };

      // Should revert when pool is closed
      await expect(swapRouter.connect(whitelistedUser).exactInput(swapParams))
        .to.be.reverted;
    });

    it("Should not allow exactOutput swap when pool is closed", async function () {
      const { admin, whitelistedUser, tokenA, tokenB, token0, token1, swapRouter, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address"],
        [tokenB.target, 3000, tokenA.target]
      );

      // Try exactOutput after pool is closed
      const swapParams = {
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("5"),
        amountInMaximum: ethers.parseEther("10"),
      };

      // Should revert when pool is closed
      await expect(swapRouter.connect(whitelistedUser).exactOutput(swapParams))
        .to.be.reverted;
    });

    it("Should not allow increase liquidity when pool is closed", async function () {
      const { admin, whitelistedUser, token0, token1, positionManager, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Create a position first
      const mintParams = {
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        recipient: whitelistedUser.address,
        amount0Desired: ethers.parseEther("1000"),
        amount1Desired: ethers.parseEther("1000"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      const mintTx = await positionManager
        .connect(whitelistedUser)
        .mint(mintParams);
      const mintReceipt = await mintTx.wait();
      const userTokenId = mintReceipt.logs[4].args[0];

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      // Try to increase liquidity after pool is closed
      const increaseParams = {
        tokenId: userTokenId,
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Should revert when pool is closed
      await expect(
        positionManager
          .connect(whitelistedUser)
          .increaseLiquidity(increaseParams)
      ).to.be.reverted;
    });

    it("Should not allow admin to increase liquidity when pool is closed", async function () {
      const { admin, token0, token1, positionManager, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Create a position first
      const mintParams = {
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        recipient: admin.address,
        amount0Desired: ethers.parseEther("1000"),
        amount1Desired: ethers.parseEther("1000"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      const mintTx = await positionManager.connect(admin).mint(mintParams);
      const mintReceipt = await mintTx.wait();
      const adminTokenId = mintReceipt.logs[4].args[0];

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      // Admin should NOT be able to increase liquidity when pool is closed
      const increaseParams = {
        tokenId: adminTokenId,
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Should revert even for admin
      await expect(
        positionManager.connect(admin).increaseLiquidity(increaseParams)
      ).to.be.reverted;
    });

    it("Should allow collect fees when pool is closed (closed != paused)", async function () {
      const { admin, whitelistedUser, token0, token1, positionManager, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Create a position
      const mintParams = {
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        recipient: whitelistedUser.address,
        amount0Desired: ethers.parseEther("1000"),
        amount1Desired: ethers.parseEther("1000"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      const mintTx = await positionManager
        .connect(whitelistedUser)
        .mint(mintParams);
      const mintReceipt = await mintTx.wait();
      const userTokenId = mintReceipt.logs[4].args[0];

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      // Collect IS allowed when pool is closed (only paused blocks it)
      const collectParams = {
        tokenId: userTokenId,
        recipient: whitelistedUser.address,
        amount0Max: new BigNumber(
          "0xffffffffffffffffffffffffffffffff",
          16
        ).toString(),
        amount1Max: new BigNumber(
          "0xffffffffffffffffffffffffffffffff",
          16
        ).toString(),
      };

      // Should succeed when pool is closed (closed != paused)
      await positionManager.connect(whitelistedUser).collect(collectParams);
    });

    it("Should allow owner to remove position when pool is closed (closed != paused)", async function () {
      const { admin, whitelistedUser, token0, token1, positionManager, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Create a position owned by whitelistedUser
      const mintParams = {
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        recipient: whitelistedUser.address,
        amount0Desired: ethers.parseEther("1000"),
        amount1Desired: ethers.parseEther("1000"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      const mintTx = await positionManager
        .connect(whitelistedUser)
        .mint(mintParams);
      const mintReceipt = await mintTx.wait();
      const userTokenId = mintReceipt.logs[4].args[0];

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      // Admin can remove position when pool is closed (removePosition is admin-only)
      await positionManager.connect(admin).removePosition({tokenId: userTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256});

      // Verify position is removed
      await expect(positionManager.positions(userTokenId)).to.be.revertedWith(
        "Invalid token ID"
      );
    });

    it("Should allow admin to remove multiple positions when pool is closed", async function () {
      const { admin, whitelistedUser, token0, token1, positionManager, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Create two positions
      const mintParams = {
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        recipient: whitelistedUser.address,
        amount0Desired: ethers.parseEther("1000"),
        amount1Desired: ethers.parseEther("1000"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      const mintTx1 = await positionManager
        .connect(whitelistedUser)
        .mint(mintParams);
      const mintReceipt1 = await mintTx1.wait();
      const tokenId1 = mintReceipt1.logs[4].args[0];

      const mintTx2 = await positionManager
        .connect(whitelistedUser)
        .mint(mintParams);
      const mintReceipt2 = await mintTx2.wait();
      const tokenId2 = mintReceipt2.logs[4].args[0];

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      // Admin should be able to remove multiple positions when pool is closed
      await positionManager
        .connect(admin)
        .removePositions([{tokenId: tokenId1, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}, {tokenId: tokenId2, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}]);

      // Verify both positions are removed
      await expect(positionManager.positions(tokenId1)).to.be.revertedWith(
        "Invalid token ID"
      );
      await expect(positionManager.positions(tokenId2)).to.be.revertedWith(
        "Invalid token ID"
      );
    });

    it("Should emit PoolCloseDateSet event when pool close date is set", async function () {
      const { admin, pool, fusangPoolState } = await loadFixture(deploy);

      const futureTimestamp = Math.floor(Date.now() / 1000) + 86400; // 1 day in future

      // Should emit event when setting close date
      await expect(fusangPoolState.connect(admin).setPoolCloseDate(pool.target, futureTimestamp))
        .to.emit(fusangPoolState, "PoolCloseDateSet")
        .withArgs(pool.target, futureTimestamp);
    });

    it("Should allow operations to resume after removing pool close date", async function () {
      const { admin, whitelistedUser, tokenA, tokenB, token0, token1, swapRouter, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Set pool close date to past
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

      // Verify swap fails when pool is closed
      const swapParams = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      await expect(
        swapRouter.connect(whitelistedUser).exactInputSingle(swapParams)
      ).to.be.reverted;

      // Remove close date (set to 0)
      await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, 0);

      // Verify operations work after removing close date
      await swapRouter.connect(whitelistedUser).exactInputSingle(swapParams);
    });

    it("Should not allow non-admin to set pool close date", async function () {
      const { whitelistedUser, pool, fusangPoolState } = await loadFixture(deploy);

      const futureTimestamp = Math.floor(Date.now() / 1000) + 86400;

      // Non-admin should not be able to set pool close date
      await expect(
        fusangPoolState.connect(whitelistedUser).setPoolCloseDate(pool.target, futureTimestamp)
      ).to.be.reverted;
    });
  });

  // it("Should prevent a non-whitelisted user from removing position", async function () {
  //   const { nonWhitelistedUser, positionManager, tokenId } = await loadFixture(
  //     deploy
  //   );

  //   await expect(
  //     positionManager.connect(nonWhitelistedUser).removePosition(tokenId)
  //   ).to.be.revertedWith("Not whitelisted");
  // });

  it("Should allow the factory owner to remove multiple positions when pool is inactive", async function () {
    const { admin, positionManager, tokenId, token0, token1, pool, fusangPoolState } =
      await loadFixture(deploy);

    // Create a second position
    const mintParams = {
      token0: token0.target,
      token1: token1.target,
      fee: 3000,
      tickLower: getMinTick(60),
      tickUpper: getMaxTick(60),
      recipient: admin.address,
      amount0Desired: ethers.parseEther("10000"),
      amount1Desired: ethers.parseEther("10000"),
      amount0Min: 0,
      amount1Min: 0,
      deadline: ethers.MaxUint256,
    };

    // Add liquidity to create a second position
    const mint_2 = await positionManager.connect(admin).mint(mintParams);

    const receipt = await mint_2.wait();
    const tokenId2 = receipt.logs[4].args[0];

    // Pause pool first (removePosition requires inactive pool)
    await fusangPoolState.connect(admin).pausePool(pool.target);

    // Call removePositions (admin is the factory owner in the test setup)
    await positionManager.connect(admin).removePositions([{tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}, {tokenId: tokenId2, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}]);
  });

  it("Should prevent a non-owner from removing multiple positions", async function () {
    const { whitelistedUser, positionManager, tokenId } = await loadFixture(
      deploy
    );

    await expect(
      positionManager.connect(whitelistedUser).removePositions([{tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}])
    ).to.be.reverted;
  });

  // it("Should prevent a non-whitelisted user from burning position", async function () {
  //   const { nonWhitelistedUser, positionManager, tokenId } = await loadFixture(
  //     deploy
  //   );

  //   await expect(
  //     positionManager.connect(nonWhitelistedUser).burn(tokenId)
  //   ).to.be.revertedWith("Not whitelisted");
  // });

  it("Only admin can set pool close date", async function () {
    const { whitelistedUser, pool, fusangPoolState } = await loadFixture(deploy);

    await expect(
      fusangPoolState
        .connect(whitelistedUser)
        .setPoolCloseDate(pool.target, Math.floor(Date.now() / 1000) + 60)
    ).to.be.reverted;
  });

  it("Should not allow decreasing liquidity belonging to another user (but admin can remove positions)", async function () {
    const { admin, whitelistedUser, whitelistedUser2, token0, token1, positionManager, pool, fusangPoolState } =
      await loadFixture(deploy);

    const mintParams = {
      token0: token0.target,
      token1: token1.target,
      fee: 3000,
      tickLower: getMinTick(60),
      tickUpper: getMaxTick(60),
      amount0Desired: ethers.parseEther("10000"),
      amount1Desired: ethers.parseEther("10000"),
      amount0Min: 0,
      amount1Min: 0,
      recipient: whitelistedUser.address,
      deadline: ethers.MaxUint256,
    };

    const mintTx = await positionManager
      .connect(whitelistedUser)
      .mint(mintParams);
    const mintReceipt = await mintTx.wait();

    const tokenId = mintReceipt.logs[4].args[0];

    // Test 1: whitelistedUser2 should not be able to decrease liquidity of whitelistedUser's position
    // (decreaseLiquidity requires owner/approved)
    const decreaseLiquidityParams = {
      tokenId: tokenId,
      liquidity: 100,
      amount0Min: 0,
      amount1Min: 0,
      deadline: ethers.MaxUint256,
    };

    await expect(
      positionManager.connect(whitelistedUser2).decreaseLiquidity(decreaseLiquidityParams)
    ).to.be.revertedWith("Not approved");

    // Test 2: admin CAN remove any position when pool is inactive
    await fusangPoolState.connect(admin).pausePool(pool.target);
    await positionManager.connect(admin).removePosition({tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256});
  });

  it("Should not allow swapping when pool is closed", async function () {
    const { admin, whitelistedUser, tokenA, tokenB, swapRouter, pool, fusangPoolState } =
      await loadFixture(deploy);

    // Set pool close date to past
    const pastTimestamp = Math.floor(Date.now() / 1000) - 86400; // 1 day in the past
    await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

    // Try to swap after pool is closed
    const exactInputSingleParams = {
      tokenIn: tokenA.target,
      tokenOut: tokenB.target,
      fee: 3000,
      recipient: whitelistedUser.address,
      deadline: ethers.MaxUint256,
      amountIn: ethers.parseEther("10"),
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    };

    // Should revert with LOK (pool locked)
    await expect(
      swapRouter
        .connect(whitelistedUser)
        .exactInputSingle(exactInputSingleParams)
    ).to.be.reverted;
  });

  it("Should not allow minting when pool is closed", async function () {
    const { admin, whitelistedUser, token0, token1, positionManager, pool, fusangPoolState } =
      await loadFixture(deploy);

    // Set pool close date to past
    const pastTimestamp = Math.floor(Date.now() / 1000) - 86400; // 1 day in the past
    await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

    // Try to mint position after pool is closed
    const mintParams = {
      token0: token0.target,
      token1: token1.target,
      fee: 3000,
      tickLower: getMinTick(60),
      tickUpper: getMaxTick(60),
      recipient: whitelistedUser.address,
      amount0Desired: ethers.parseEther("10"),
      amount1Desired: ethers.parseEther("10"),
      amount0Min: 0,
      amount1Min: 0,
      deadline: ethers.MaxUint256,
    };

    // Should revert with LOK (pool locked)
    await expect(positionManager.connect(whitelistedUser).mint(mintParams)).to
      .be.reverted;
  });

  it("Should allow owner and admin to remove position when pool close date has passed (closed != paused)", async function () {
    const { admin, whitelistedUser, token0, token1, positionManager, pool, fusangPoolState } =
      await loadFixture(deploy);

    // Create a position owned by whitelistedUser
    const mintParams = {
      token0: token0.target,
      token1: token1.target,
      fee: 3000,
      tickLower: getMinTick(60),
      tickUpper: getMaxTick(60),
      recipient: whitelistedUser.address,
      amount0Desired: ethers.parseEther("1000"),
      amount1Desired: ethers.parseEther("1000"),
      amount0Min: 0,
      amount1Min: 0,
      deadline: ethers.MaxUint256,
    };

    const mintTx = await positionManager
      .connect(whitelistedUser)
      .mint(mintParams);
    const mintReceipt = await mintTx.wait();
    const userTokenId = mintReceipt.logs[4].args[0];

    // Set pool close date to past (closed != paused, so owner can still remove)
    const pastTimestamp = Math.floor(Date.now() / 1000) - 86400; // 1 day in the past
    await fusangPoolState.connect(admin).setPoolCloseDate(pool.target, pastTimestamp);

    // Admin can remove position when pool is closed (removePosition is admin-only + inactive pool)
    await positionManager.connect(admin).removePosition({tokenId: userTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256});

    // Verify the position has been removed
    await expect(positionManager.positions(userTokenId)).to.be.revertedWith(
      "Invalid token ID"
    );
  });

  // Pause functionality tests
  describe("Pool Pause Functionality", function () {
    it("Should not allow swapping when pool is paused", async function () {
      const { admin, whitelistedUser, tokenA, tokenB, token0, token1, swapRouter, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Try to swap when pool is paused
      const exactInputSingleParams = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      // Should revert when pool is paused
      await expect(
        swapRouter
          .connect(whitelistedUser)
          .exactInputSingle(exactInputSingleParams)
      ).to.be.reverted;
    });

    it("Should not allow factory owner to swap when pool is paused", async function () {
      const { admin, tokenA, tokenB, token0, token1, swapRouter, pool, fusangPoolState } = await loadFixture(
        deploy
      );

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Factory owner should not be able to swap when pool is paused
      const exactInputSingleParams = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      // Should revert for factory owner too
      await expect(
        swapRouter.connect(admin).exactInputSingle(exactInputSingleParams)
      ).to.be.reverted;
    });

    it("Should not allow minting when pool is paused", async function () {
      const { admin, whitelistedUser, token0, token1, positionManager, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Try to mint position when pool is paused
      const mintParams = {
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        recipient: whitelistedUser.address,
        amount0Desired: ethers.parseEther("10"),
        amount1Desired: ethers.parseEther("10"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Should revert when pool is paused
      await expect(positionManager.connect(whitelistedUser).mint(mintParams)).to
        .be.reverted;
    });

    it("Should not allow factory owner to mint when pool is paused", async function () {
      const { admin, token0, token1, positionManager, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Factory owner should not be able to mint when pool is paused
      const mintParams = {
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        recipient: admin.address,
        amount0Desired: ethers.parseEther("10"),
        amount1Desired: ethers.parseEther("10"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Should revert for factory owner too
      await expect(positionManager.connect(admin).mint(mintParams)).to.be
        .reverted;
    });

    it("Should not allow decreasing liquidity when pool is paused", async function () {
      const { admin, whitelistedUser, positionManager, pool, tokenId, fusangPoolState } =
        await loadFixture(deploy);

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Try to decrease liquidity when pool is paused
      const decreaseParams = {
        tokenId: tokenId,
        liquidity: 1,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Should revert when pool is paused
      await expect(
        positionManager
          .connect(whitelistedUser)
          .decreaseLiquidity(decreaseParams)
      ).to.be.reverted;
    });

    it("Should not allow factory owner to decrease liquidity when pool is paused (no admin bypass)", async function () {
      const { admin, positionManager, pool, tokenId, fusangPoolState } = await loadFixture(
        deploy
      );

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Factory owner should not be able to decrease liquidity when pool is paused
      // (decreaseLiquidity has no admin bypass, uses _checkPoolNotPaused)
      const decreaseParams = {
        tokenId: tokenId,
        liquidity: 1,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Should revert for factory owner too
      await expect(
        positionManager.connect(admin).decreaseLiquidity(decreaseParams)
      ).to.be.reverted;
    });

    it("Should not allow collecting fees when pool is paused", async function () {
      const { admin, whitelistedUser, positionManager, pool, tokenId, fusangPoolState } =
        await loadFixture(deploy);

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Try to collect fees when pool is paused
      const collectParams = {
        tokenId: tokenId,
        recipient: whitelistedUser.address,
        amount0Max: 1,
        amount1Max: 1,
      };

      // Should revert when pool is paused
      await expect(
        positionManager.connect(whitelistedUser).collect(collectParams)
      ).to.be.reverted;
    });

    it("Should not allow factory owner to collect fees when pool is paused (no admin bypass)", async function () {
      const { admin, positionManager, pool, tokenId, fusangPoolState } = await loadFixture(
        deploy
      );

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Factory owner should not be able to collect fees when pool is paused
      // (collect has no admin bypass, uses _checkPoolNotPaused)
      const collectParams = {
        tokenId: tokenId,
        recipient: admin.address,
        amount0Max: 1,
        amount1Max: 1,
      };

      // Should revert for factory owner too
      await expect(
        positionManager.connect(admin).collect(collectParams)
      ).to.be.reverted;
    });

    it("Should not allow increasing liquidity when pool is paused", async function () {
      const { admin, whitelistedUser, positionManager, pool, tokenId, fusangPoolState } =
        await loadFixture(deploy);

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Try to increase liquidity when pool is paused
      const increaseParams = {
        tokenId: tokenId,
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Should revert when pool is paused
      await expect(
        positionManager
          .connect(whitelistedUser)
          .increaseLiquidity(increaseParams)
      ).to.be.reverted;
    });

    it("Should not allow factory owner to increase liquidity when pool is paused", async function () {
      const { admin, positionManager, pool, tokenId, fusangPoolState } = await loadFixture(
        deploy
      );

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Factory owner should not be able to increase liquidity when pool is paused
      const increaseParams = {
        tokenId: tokenId,
        amount0Desired: ethers.parseEther("100"),
        amount1Desired: ethers.parseEther("100"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Should revert for factory owner too
      await expect(
        positionManager.connect(admin).increaseLiquidity(increaseParams)
      ).to.be.reverted;
    });

    it("Should allow operations to resume after unpausing", async function () {
      const {
        admin,
        whitelistedUser,
        tokenA,
        tokenB,
        swapRouter,
        positionManager,
        pool,
        fusangPoolState,
      } = await loadFixture(deploy);

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Verify pool is paused
      expect(await fusangPoolState.isPoolPaused(pool.target)).to.be.true;

      // Try to swap when paused (should fail)
      const exactInputSingleParams = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      };

      await expect(
        swapRouter
          .connect(whitelistedUser)
          .exactInputSingle(exactInputSingleParams)
      ).to.be.reverted;

      // Unpause the pool
      await fusangPoolState.connect(admin).unpausePool(pool.target);

      // Verify pool is unpaused
      expect(await fusangPoolState.isPoolPaused(pool.target)).to.be.false;

      // Try to swap after unpausing (should succeed)
      await swapRouter
        .connect(whitelistedUser)
        .exactInputSingle(exactInputSingleParams);
    });

    it("Should not allow non-owner to pause/unpause pool", async function () {
      const { whitelistedUser, pool, fusangPoolState } = await loadFixture(deploy);

      // Non-owner should not be able to pause pool
      await expect(fusangPoolState.connect(whitelistedUser).pausePool(pool.target)).to.be
        .reverted;

      // Non-owner should not be able to unpause pool
      await expect(fusangPoolState.connect(whitelistedUser).unpausePool(pool.target)).to.be
        .reverted;
    });

    it("Should emit PoolPaused/PoolUnpaused event when pool is paused/unpaused", async function () {
      const { admin, pool, fusangPoolState } = await loadFixture(deploy);

      // Pause the pool and check event
      await expect(fusangPoolState.connect(admin).pausePool(pool.target))
        .to.emit(fusangPoolState, "PoolPaused")
        .withArgs(pool.target);

      // Unpause the pool and check event
      await expect(fusangPoolState.connect(admin).unpausePool(pool.target))
        .to.emit(fusangPoolState, "PoolUnpaused")
        .withArgs(pool.target);
    });

    it("Should not allow exactOutputSingle when pool is paused", async function () {
      const { admin, whitelistedUser, tokenA, tokenB, token0, token1, swapRouter, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Try exactOutputSingle when pool is paused
      const exactOutputSingleParams = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("5"),
        amountInMaximum: ethers.parseEther("10"),
        sqrtPriceLimitX96: 0,
      };

      // Should revert when pool is paused
      await expect(
        swapRouter
          .connect(whitelistedUser)
          .exactOutputSingle(exactOutputSingleParams)
      ).to.be.reverted;
    });

    it("Should not allow factory owner to use exactOutputSingle when pool is paused", async function () {
      const { admin, tokenA, tokenB, token0, token1, swapRouter, pool, fusangPoolState } = await loadFixture(
        deploy
      );

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Factory owner should not be able to use exactOutputSingle when pool is paused
      const exactOutputSingleParams = {
        tokenIn: tokenA.target,
        tokenOut: tokenB.target,
        fee: 3000,
        recipient: admin.address,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("5"),
        amountInMaximum: ethers.parseEther("10"),
        sqrtPriceLimitX96: 0,
      };

      // Should revert for factory owner too
      await expect(
        swapRouter.connect(admin).exactOutputSingle(exactOutputSingleParams)
      ).to.be.reverted;
    });

    it("Should not allow exactInput when pool is paused", async function () {
      const { admin, whitelistedUser, tokenA, tokenB, token0, token1, swapRouter, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address"],
        [tokenA.target, 3000, tokenB.target]
      );

      // Try exactInput when pool is paused
      const exactInputParams = {
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountIn: ethers.parseEther("10"),
        amountOutMinimum: 0,
      };

      // Should revert when pool is paused
      await expect(
        swapRouter.connect(whitelistedUser).exactInput(exactInputParams)
      ).to.be.reverted;
    });

    it("Should not allow exactOutput when pool is paused", async function () {
      const { admin, whitelistedUser, tokenA, tokenB, token0, token1, swapRouter, pool, fusangPoolState } =
        await loadFixture(deploy);

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      const path = ethers.solidityPacked(
        ["address", "uint24", "address"],
        [tokenB.target, 3000, tokenA.target]
      );

      // Try exactOutput when pool is paused
      const exactOutputParams = {
        path: path,
        recipient: whitelistedUser.address,
        deadline: ethers.MaxUint256,
        amountOut: ethers.parseEther("5"),
        amountInMaximum: ethers.parseEther("10"),
      };

      // Should revert when pool is paused
      await expect(
        swapRouter.connect(whitelistedUser).exactOutput(exactOutputParams)
      ).to.be.reverted;
    });

    it("Should not allow removing positions when pool is paused", async function () {
      const { admin, whitelistedUser, positionManager, pool, tokenId, fusangPoolState } =
        await loadFixture(deploy);

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Try to remove position when pool is paused
      await expect(
        positionManager.connect(whitelistedUser).removePosition({tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256})
      ).to.be.reverted;
    });

    it("Should allow factory owner to remove positions when pool is paused", async function () {
      const { admin, positionManager, pool, tokenId, fusangPoolState } = await loadFixture(
        deploy
      );

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Factory owner should be able to remove position when pool is paused
      // This includes decreasing liquidity and collecting fees as part of the removal process
      await positionManager.connect(admin).removePosition({tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256});

      // Verify the position has been removed
      await expect(positionManager.positions(tokenId)).to.be.revertedWith(
        "Invalid token ID"
      );
    });

    it("Should allow admin to remove positions (including collect fees and decrease liquidity) when pool is paused", async function () {
      const { admin, positionManager, pool, tokenId, fusangPoolState } = await loadFixture(
        deploy
      );

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Admin should be able to remove position when pool is paused
      // This includes decreasing liquidity and collecting fees as part of the removal process
      await positionManager.connect(admin).removePosition({tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256});

      // Verify the position has been removed
      await expect(positionManager.positions(tokenId)).to.be.revertedWith(
        "Invalid token ID"
      );
    });

    it("Should allow admin to remove multiple positions when pool is paused", async function () {
      const { admin, positionManager, pool, tokenId, token0, token1, fusangPoolState } =
        await loadFixture(deploy);

      // Create a second position
      const mintParams = {
        token0: token0.target,
        token1: token1.target,
        fee: 3000,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        recipient: admin.address,
        amount0Desired: ethers.parseEther("1000"),
        amount1Desired: ethers.parseEther("1000"),
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256,
      };

      // Add liquidity to create a second position (before pausing)
      const mint_2 = await positionManager.connect(admin).mint(mintParams);
      const receipt = await mint_2.wait();
      const tokenId2 = receipt.logs[4].args[0];

      // Pause the pool
      await fusangPoolState.connect(admin).pausePool(pool.target);

      // Admin should be able to remove multiple positions when pool is paused
      // This includes decreasing liquidity and collecting fees for all positions
      await positionManager.connect(admin).removePositions([{tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}, {tokenId: tokenId2, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256}]);

      // Verify both positions have been removed
      await expect(positionManager.positions(tokenId)).to.be.revertedWith(
        "Invalid token ID"
      );

      await expect(positionManager.positions(tokenId2)).to.be.revertedWith(
        "Invalid token ID"
      );
    });

    // _validatePool tests: if (pool.paused() && !isPoolAdmin) { revert(); }
    describe("_validatePool logic", function () {
      it("Should revert for non-admin when pool is paused (decreaseLiquidity)", async function () {
        const { admin, whitelistedUser, token0, token1, positionManager, pool, fusangPoolState } =
          await loadFixture(deploy);

        // Create a position for whitelistedUser
        const mintParams = {
          token0: token0.target,
          token1: token1.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          recipient: whitelistedUser.address,
          amount0Desired: ethers.parseEther("1000"),
          amount1Desired: ethers.parseEther("1000"),
          amount0Min: 0,
          amount1Min: 0,
          deadline: ethers.MaxUint256,
        };

        const mintTx = await positionManager
          .connect(whitelistedUser)
          .mint(mintParams);
        const mintReceipt = await mintTx.wait();
        const userTokenId = mintReceipt.logs[4].args[0];

        // Pause the pool
        await fusangPoolState.connect(admin).pausePool(pool.target);

        // Verify pool is paused
        expect(await fusangPoolState.isPoolPaused(pool.target)).to.be.true;

        // Non-admin should NOT be able to decrease liquidity when paused
        // This tests: if (pool.paused() && !isPoolAdmin) { revert(); }
        const decreaseParams = {
          tokenId: userTokenId,
          liquidity: 1,
          amount0Min: 0,
          amount1Min: 0,
          deadline: ethers.MaxUint256,
        };

        await expect(
          positionManager
            .connect(whitelistedUser)
            .decreaseLiquidity(decreaseParams)
        ).to.be.reverted;
      });

      it("Should not allow admin when pool is paused (decreaseLiquidity - no admin bypass)", async function () {
        const { admin, positionManager, pool, tokenId, fusangPoolState } = await loadFixture(
          deploy
        );

        // Pause the pool
        await fusangPoolState.connect(admin).pausePool(pool.target);

        // Verify pool is paused
        expect(await fusangPoolState.isPoolPaused(pool.target)).to.be.true;

        // Admin cannot decrease liquidity when paused (no admin bypass for decreaseLiquidity)
        // decreaseLiquidity uses _checkPoolNotPaused which reverts for all callers
        const decreaseParams = {
          tokenId: tokenId,
          liquidity: 1,
          amount0Min: 0,
          amount1Min: 0,
          deadline: ethers.MaxUint256,
        };

        // Should revert even for admin (no bypass for decreaseLiquidity)
        await expect(
          positionManager.connect(admin).decreaseLiquidity(decreaseParams)
        ).to.be.reverted;
      });

      it("Should revert for non-admin when pool is paused (collect)", async function () {
        const { admin, whitelistedUser, token0, token1, positionManager, pool, fusangPoolState } =
          await loadFixture(deploy);

        // Create a position for whitelistedUser
        const mintParams = {
          token0: token0.target,
          token1: token1.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          recipient: whitelistedUser.address,
          amount0Desired: ethers.parseEther("1000"),
          amount1Desired: ethers.parseEther("1000"),
          amount0Min: 0,
          amount1Min: 0,
          deadline: ethers.MaxUint256,
        };

        const mintTx = await positionManager
          .connect(whitelistedUser)
          .mint(mintParams);
        const mintReceipt = await mintTx.wait();
        const userTokenId = mintReceipt.logs[4].args[0];

        // Pause the pool
        await fusangPoolState.connect(admin).pausePool(pool.target);

        // Non-admin should NOT be able to collect when paused
        // This tests: if (pool.paused() && !isPoolAdmin) { revert(); }
        const collectParams = {
          tokenId: userTokenId,
          recipient: whitelistedUser.address,
          amount0Max: new BigNumber(
            "0xffffffffffffffffffffffffffffffff",
            16
          ).toString(),
          amount1Max: new BigNumber(
            "0xffffffffffffffffffffffffffffffff",
            16
          ).toString(),
        };

        await expect(
          positionManager.connect(whitelistedUser).collect(collectParams)
        ).to.be.reverted;
      });

      it("Should not allow admin when pool is paused (collect - no admin bypass)", async function () {
        const { admin, positionManager, pool, tokenId, fusangPoolState } = await loadFixture(
          deploy
        );

        // Pause the pool
        await fusangPoolState.connect(admin).pausePool(pool.target);

        // Admin cannot collect when paused (no admin bypass for collect)
        // collect uses _checkPoolNotPaused which reverts for all callers
        const collectParams = {
          tokenId: tokenId,
          recipient: admin.address,
          amount0Max: 1,
          amount1Max: 1,
        };

        // Should revert even for admin (no bypass for collect)
        await expect(
          positionManager.connect(admin).collect(collectParams)
        ).to.be.reverted;
      });

      it("Should revert for non-admin when pool is paused (removePosition)", async function () {
        const { admin, whitelistedUser, token0, token1, positionManager, pool, fusangPoolState } =
          await loadFixture(deploy);

        // Create a position for whitelistedUser
        const mintParams = {
          token0: token0.target,
          token1: token1.target,
          fee: 3000,
          tickLower: getMinTick(60),
          tickUpper: getMaxTick(60),
          recipient: whitelistedUser.address,
          amount0Desired: ethers.parseEther("1000"),
          amount1Desired: ethers.parseEther("1000"),
          amount0Min: 0,
          amount1Min: 0,
          deadline: ethers.MaxUint256,
        };

        const mintTx = await positionManager
          .connect(whitelistedUser)
          .mint(mintParams);
        const mintReceipt = await mintTx.wait();
        const userTokenId = mintReceipt.logs[4].args[0];

        // Pause the pool
        await fusangPoolState.connect(admin).pausePool(pool.target);

        // Non-admin should NOT be able to remove position when paused
        // This tests: if (pool.paused() && !isPoolAdmin) { revert(); }
        await expect(
          positionManager.connect(whitelistedUser).removePosition({tokenId: userTokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256})
        ).to.be.reverted;
      });

      it("Should allow admin when pool is paused (removePosition)", async function () {
        const { admin, positionManager, pool, tokenId, fusangPoolState } = await loadFixture(
          deploy
        );

        // Pause the pool
        await fusangPoolState.connect(admin).pausePool(pool.target);

        // Admin SHOULD be able to remove position when paused
        // This tests: if (pool.paused() && !isPoolAdmin) { revert(); } - admin bypasses this check
        await positionManager.connect(admin).removePosition({tokenId, amount0Min: 0, amount1Min: 0, deadline: ethers.MaxUint256});

        // Verify position is removed
        await expect(positionManager.positions(tokenId)).to.be.revertedWith(
          "Invalid token ID"
        );
      });
    });
  });

  // baseURI test
  describe("NonfungiblePositionManager baseURI", function () {
    it("Should return empty string for baseURI", async function () {
      const { positionManager } = await loadFixture(deploy);

      // baseURI should return empty string (bytecode optimization)
      const baseUri = await positionManager.baseURI();
      expect(baseUri).to.equal("");
    });
  });
});

describe("FusangSwapFactory", function () {
  async function deploy() {
    const [admin, member] = await ethers.getSigners();

    const walletListFactory = await ethers.getContractFactory("WalletList");
    const walletListContract = await walletListFactory.deploy();
    const tokenFactory = await ethers.getContractFactory(
      "contracts/core/test/TestERC20.sol:TestERC20"
    );
    const tokenA = await tokenFactory.deploy(1000);
    const tokenB = await tokenFactory.deploy(1000);

    // Deploy FusangAllowList (uses walletList for admin)
    const allowListFactory = await ethers.getContractFactory("FusangAllowList");
    const allowListContract = await allowListFactory.deploy(walletListContract.target);

    // Deploy FusangFactory with allowList
    const factory = await ethers.getContractFactory("FusangFactory");
    const factoryContract = await factory.deploy(allowListContract.target);

    // FROZENLIST→MEMBER already set in constructor
    await walletListContract.setRoleManageList(
      BLACKLIST,
      DEFAULT_ADMIN_ROLE,
      true
    );
    await walletListContract.setRoleManageList(
      FROZENLIST,
      DEFAULT_ADMIN_ROLE,
      true
    );
    await walletListContract.addToList(
      MEMBER,
      DEFAULT_ADMIN_ROLE,
      factoryContract.target
    );
    await factoryContract.enableFeeAmount(250, 15);

    // Deploy DelegateCallAttack contract
    const delegateCallAttack = await ethers.getContractFactory(
      "DelegateCallAttack"
    );
    const delegateCallAttackContract = await delegateCallAttack.deploy(
      factoryContract.target
    );
    return {
      admin,
      member,
      tokenA,
      tokenB,
      walletListContract,
      factoryContract,
      delegateCallAttackContract,
    };
  }

  it("Create pool by admin", async function () {
    const { factoryContract, tokenA, tokenB } = await loadFixture(deploy);
    await factoryContract.createPool(tokenA.target, tokenB.target, 250);
  });

  it("Member or normal user cannot create a pool", async function () {
    const { factoryContract, member, tokenA, tokenB } = await loadFixture(
      deploy
    );
    await expect(
      factoryContract
        .connect(member)
        .createPool(tokenA.target, tokenB.target, 250)
    ).to.be.reverted;
  });

  it("should prevent delegatecall to createPool", async function () {
    const { delegateCallAttackContract, tokenA, tokenB } = await loadFixture(
      deploy
    );
    await expect(
      delegateCallAttackContract.attack(tokenA.target, tokenB.target, 250)
    ).to.be.revertedWith("Delegatecall failed");
  });
});
