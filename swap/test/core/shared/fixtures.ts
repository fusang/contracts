// @ts-nocheck - Hardhat contracts use dynamic methods not typed in BaseContract
import { ethers } from "hardhat";
import { Contract } from "ethers";

// Monday, October 5, 2020 9:00:00 AM GMT-05:00
export const TEST_POOL_START_TIME = 1601906400;

interface FactoryFixture {
  factory: Contract;
  allowList: Contract;
}

async function factoryFixture(): Promise<FactoryFixture> {
  const signers = await ethers.getSigners();

  // Deploy WalletList for admin role management
  const walletListFactory = await ethers.getContractFactory("WalletList");
  const walletList = await walletListFactory.deploy();

  // Deploy allowlist (uses walletList for admin)
  const allowListFactory = await ethers.getContractFactory("FusangAllowList");
  const allowList = await allowListFactory.deploy(walletList.target);

  // Use FusangFactory which has allowList support
  const factoryFactory = await ethers.getContractFactory("FusangFactory");
  const factory = await factoryFactory.deploy(allowList.target);

    // Add all signers to allowlist (they may need to interact with pools)
  for (const signer of signers) {
    await allowList.setAllowed(await signer.getAddress(), true);
  }

  return { factory, allowList };
}

interface TokensFixture {
  token0: Contract;
  token1: Contract;
  token2: Contract;
}

async function tokensFixture(): Promise<TokensFixture> {
  const tokenFactory = await ethers.getContractFactory("contracts/core/test/TestERC20.sol:TestERC20");
  const tokenA = await tokenFactory.deploy(2n ** 255n);
  const tokenB = await tokenFactory.deploy(2n ** 255n);
  const tokenC = await tokenFactory.deploy(2n ** 255n);

  const [token0, token1, token2] = [tokenA, tokenB, tokenC].sort((a, b) =>
    a.target.toLowerCase() < b.target.toLowerCase() ? -1 : 1
  );

  return { token0, token1, token2 };
}

type TokensAndFactoryFixture = FactoryFixture & TokensFixture;

interface PoolFixture extends TokensAndFactoryFixture {
  allowList: Contract;
  swapTargetCallee: Contract;
  swapTargetRouter: Contract;
  createPool(
    fee: number,
    tickSpacing: number,
    firstToken?: Contract,
    secondToken?: Contract
  ): Promise<Contract>;
}

export async function poolFixture(): Promise<PoolFixture> {
  const { factory, allowList } = await factoryFixture();
  const { token0, token1, token2 } = await tokensFixture();

  const MockTimeUniswapV3PoolDeployerFactory = await ethers.getContractFactory(
    "MockTimeUniswapV3PoolDeployer"
  );
  const MockTimeUniswapV3PoolFactory = await ethers.getContractFactory("MockTimeUniswapV3Pool");

  const calleeContractFactory = await ethers.getContractFactory("contracts/core/test/TestUniswapV3Callee.sol:TestUniswapV3Callee");
  const routerContractFactory = await ethers.getContractFactory("TestUniswapV3Router");

  const swapTargetCallee = await calleeContractFactory.deploy();
  const swapTargetRouter = await routerContractFactory.deploy();

  // Add swap targets to allowList so they can interact with pools
  await allowList.setAllowed(swapTargetCallee.target, true);
  await allowList.setAllowed(swapTargetRouter.target, true);

  return {
    token0,
    token1,
    token2,
    factory,
    allowList,
    swapTargetCallee,
    swapTargetRouter,
    createPool: async (fee, tickSpacing, firstToken = token0, secondToken = token1) => {
      const mockTimePoolDeployer = await MockTimeUniswapV3PoolDeployerFactory.deploy();
      const tx = await mockTimePoolDeployer.deploy(
        await factory.getAddress(),
        await firstToken.getAddress(),
        await secondToken.getAddress(),
        fee,
        tickSpacing
      );

      const receipt = await tx.wait();
      const poolAddress = receipt.logs[0].args?.pool as string;
      return MockTimeUniswapV3PoolFactory.attach(poolAddress);
    },
  };
}
