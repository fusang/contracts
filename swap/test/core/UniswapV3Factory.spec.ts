import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Signer, ZeroAddress } from "ethers";
import { FusangFactory } from "../../typechain/contracts/FusangFactory";
import { WalletList } from "../../typechain/contracts/walletList/WalletList";
import { FeeAmount, TICK_SPACINGS, getCreate2Address } from "./shared/utilities";

const TEST_ADDRESSES: [string, string] = [
  "0x1000000000000000000000000000000000000000",
  "0x2000000000000000000000000000000000000000",
];

describe("UniswapV3Factory", () => {
  let wallet: Signer;
  let other: Signer;
  let factory: FusangFactory;
  let walletList: WalletList;
  let poolBytecode: string;

  async function factoryFixture() {
    // Deploy WalletList for admin role management
    const walletListFactory = await ethers.getContractFactory("WalletList");
    const walletList = await walletListFactory.deploy();

    const allowListFactory = await ethers.getContractFactory("FusangAllowList");
    const allowList = await allowListFactory.deploy(walletList.target);

    // Use FusangFactory with WalletList for admin management
    const factoryFactory = await ethers.getContractFactory("FusangFactory");
    const factory = await factoryFactory.deploy(allowList.target);

    return { factory, walletList, allowList };
  }

  before("load pool bytecode", async () => {
    poolBytecode = (await ethers.getContractFactory("UniswapV3Pool")).bytecode;
  });

  beforeEach("deploy factory", async () => {
    [wallet, other] = await ethers.getSigners();
    const fixtures = await loadFixture(factoryFixture);
    factory = fixtures.factory as unknown as FusangFactory;
    walletList = fixtures.walletList as unknown as WalletList;
  });

  it("deployer is admin", async () => {
    expect(await factory.isAdmin(await wallet.getAddress())).to.eq(true);
  });

  it("initial enabled fee amounts", async () => {
    expect(await factory.feeAmountTickSpacing(FeeAmount.LOW)).to.eq(TICK_SPACINGS[FeeAmount.LOW]);
    expect(await factory.feeAmountTickSpacing(FeeAmount.MEDIUM)).to.eq(TICK_SPACINGS[FeeAmount.MEDIUM]);
    expect(await factory.feeAmountTickSpacing(FeeAmount.HIGH)).to.eq(TICK_SPACINGS[FeeAmount.HIGH]);
  });

  async function createAndCheckPool(
    tokens: [string, string],
    feeAmount: FeeAmount,
    tickSpacing: number = TICK_SPACINGS[feeAmount]
  ) {
    const create2Address = getCreate2Address(
      await factory.getAddress(),
      tokens,
      feeAmount,
      poolBytecode
    );
    const create = factory.createPool(tokens[0], tokens[1], feeAmount);

    await expect(create)
      .to.emit(factory, "PoolCreated")
      .withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], feeAmount, tickSpacing, create2Address);

    await expect(factory.createPool(tokens[0], tokens[1], feeAmount)).to.be.reverted;
    await expect(factory.createPool(tokens[1], tokens[0], feeAmount)).to.be.reverted;
    expect(await factory.getPool(tokens[0], tokens[1], feeAmount), "getPool in order").to.eq(
      create2Address
    );
    expect(await factory.getPool(tokens[1], tokens[0], feeAmount), "getPool in reverse").to.eq(
      create2Address
    );

    const poolContractFactory = await ethers.getContractFactory("UniswapV3Pool");
    const pool = poolContractFactory.attach(create2Address);
    expect(await pool.factory(), "pool factory address").to.eq(await factory.getAddress());
    expect(await pool.token0(), "pool token0").to.eq(TEST_ADDRESSES[0]);
    expect(await pool.token1(), "pool token1").to.eq(TEST_ADDRESSES[1]);
    expect(await pool.fee(), "pool fee").to.eq(feeAmount);
    expect(await pool.tickSpacing(), "pool tick spacing").to.eq(tickSpacing);
  }

  describe("#createPool", () => {
    it("succeeds for low fee pool", async () => {
      await createAndCheckPool(TEST_ADDRESSES, FeeAmount.LOW);
    });

    it("succeeds for medium fee pool", async () => {
      await createAndCheckPool(TEST_ADDRESSES, FeeAmount.MEDIUM);
    });

    it("succeeds for high fee pool", async () => {
      await createAndCheckPool(TEST_ADDRESSES, FeeAmount.HIGH);
    });

    it("succeeds if tokens are passed in reverse", async () => {
      await createAndCheckPool([TEST_ADDRESSES[1], TEST_ADDRESSES[0]], FeeAmount.MEDIUM);
    });

    it("fails if token a == token b", async () => {
      await expect(factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[0], FeeAmount.LOW)).to.be
        .reverted;
    });

    it("fails if token a is 0 or token b is 0", async () => {
      await expect(factory.createPool(TEST_ADDRESSES[0], ZeroAddress, FeeAmount.LOW)).to.be.reverted;
      await expect(factory.createPool(ZeroAddress, TEST_ADDRESSES[0], FeeAmount.LOW)).to.be.reverted;
      await expect(
        factory.createPool(ZeroAddress, ZeroAddress, FeeAmount.LOW)
      ).to.be.reverted;
    });

    it("fails if fee amount is not enabled", async () => {
      await expect(factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[1], 250)).to.be.reverted;
    });
  });

  describe("#addToList/#removeFromList (via WalletList)", () => {
    it("fails if caller is not admin on WalletList", async () => {
      const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
      await expect(walletList.connect(other).addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await wallet.getAddress())).to.be.reverted;
    });

    it("adds new admin via WalletList", async () => {
      const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
      await walletList.addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await other.getAddress());
      expect(await factory.isAdmin(await other.getAddress())).to.eq(true);
    });

    it("removes admin via WalletList", async () => {
      const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
      await walletList.addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await other.getAddress());
      expect(await factory.isAdmin(await other.getAddress())).to.eq(true);
      await walletList.removeFromList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await other.getAddress());
      expect(await factory.isAdmin(await other.getAddress())).to.eq(false);
    });

    it("emits ListChanged event on add", async () => {
      const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
      await expect(walletList.addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await other.getAddress()))
        .to.emit(walletList, "ListChanged")
        .withArgs(DEFAULT_ADMIN_ROLE, await other.getAddress(), await wallet.getAddress());
    });

    it("emits ListChanged event on remove", async () => {
      const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
      await walletList.addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await other.getAddress());
      await expect(walletList.removeFromList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await other.getAddress()))
        .to.emit(walletList, "ListChanged")
        .withArgs(DEFAULT_ADMIN_ROLE, await other.getAddress(), ethers.ZeroAddress);
    });

    it("new admin can add other admins via WalletList", async () => {
      const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
      await walletList.addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await other.getAddress());
      const [, , third] = await ethers.getSigners();
      await expect(walletList.connect(other).addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await third.getAddress()))
        .to.emit(walletList, "ListChanged")
        .withArgs(DEFAULT_ADMIN_ROLE, await third.getAddress(), await other.getAddress());
    });

    it("removed admin cannot add admins via WalletList", async () => {
      const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
      await walletList.addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await other.getAddress());
      await walletList.removeFromList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await other.getAddress());
      const [, , third] = await ethers.getSigners();
      await expect(walletList.connect(other).addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await third.getAddress())).to.be.reverted;
    });
  });

  describe("#enableFeeAmount", () => {
    it("fails if caller is not admin", async () => {
      await expect(factory.connect(other).enableFeeAmount(100, 2)).to.be.reverted;
    });

    it("fails if fee is too great", async () => {
      await expect(factory.enableFeeAmount(1000000, 10)).to.be.reverted;
    });

    it("fails if tick spacing is too small", async () => {
      await expect(factory.enableFeeAmount(500, 0)).to.be.reverted;
    });

    it("fails if tick spacing is too large", async () => {
      await expect(factory.enableFeeAmount(500, 16834)).to.be.reverted;
    });

    it("fails if already initialized", async () => {
      await factory.enableFeeAmount(100, 5);
      await expect(factory.enableFeeAmount(100, 10)).to.be.reverted;
    });

    it("sets the fee amount in the mapping", async () => {
      await factory.enableFeeAmount(100, 5);
      expect(await factory.feeAmountTickSpacing(100)).to.eq(5);
    });

    it("emits an event", async () => {
      await expect(factory.enableFeeAmount(100, 5))
        .to.emit(factory, "FeeAmountEnabled")
        .withArgs(100, 5);
    });

    it("enables pool creation", async () => {
      await factory.enableFeeAmount(250, 15);
      await createAndCheckPool([TEST_ADDRESSES[0], TEST_ADDRESSES[1]], 250 as FeeAmount, 15);
    });
  });
});
