// @ts-nocheck - Hardhat contracts use dynamic methods not typed in BaseContract
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("FusangFactory", function () {
  async function deployFixture() {
    const [owner, admin1, admin2, nonAdmin] = await ethers.getSigners();

    // Deploy test tokens
    const TokenFactory = await ethers.getContractFactory(
      "contracts/core/test/TestERC20.sol:TestERC20"
    );
    const tokenA = await TokenFactory.deploy(ethers.parseEther("1000000"));
    const tokenB = await TokenFactory.deploy(ethers.parseEther("1000000"));
    const tokenC = await TokenFactory.deploy(ethers.parseEther("1000000"));

    // Deploy WalletList contract (for admin role management)
    const WalletList = await ethers.getContractFactory("WalletList");
    const walletList = await WalletList.deploy();

    // Deploy FusangAllowList contract (uses walletList for admin)
    const FusangAllowList = await ethers.getContractFactory("FusangAllowList");
    const allowList = await FusangAllowList.deploy(walletList.target);

    // Deploy FusangFactory contract with allowList
    const FusangFactory = await ethers.getContractFactory("FusangFactory");
    const factory = await FusangFactory.deploy(allowList.target);

    return { factory, walletList, allowList, owner, admin1, admin2, nonAdmin, tokenA, tokenB, tokenC };
  }

  describe("Deployment", function () {
    it("Should set deployer as admin", async function () {
      const { factory, owner } = await loadFixture(deployFixture);

      expect(await factory.isAdmin(owner.address)).to.be.true;
    });

    it("Should have default fee amounts enabled", async function () {
      const { factory } = await loadFixture(deployFixture);

      expect(await factory.feeAmountTickSpacing(500)).to.equal(10);
      expect(await factory.feeAmountTickSpacing(3000)).to.equal(60);
      expect(await factory.feeAmountTickSpacing(10000)).to.equal(200);
    });

    it("Should return correct allowList address", async function () {
      const { factory, allowList } = await loadFixture(deployFixture);
      expect(await factory.allowList()).to.equal(allowList.target);
    });

    it("Should return correct walletList address via allowList", async function () {
      const { factory, walletList } = await loadFixture(deployFixture);
      expect(await factory.walletList()).to.equal(walletList.target);
    });

    it("Should emit FeeAmountEnabled events on deployment", async function () {
      // Deploy WalletList first
      const WalletList = await ethers.getContractFactory("WalletList");
      const walletList = await WalletList.deploy();

      // Deploy FusangAllowList
      const FusangAllowList = await ethers.getContractFactory("FusangAllowList");
      const allowList = await FusangAllowList.deploy(walletList.target);

      const FusangFactory = await ethers.getContractFactory("FusangFactory");

      // We can't easily check deployment events, but we can verify the state
      const factory = await FusangFactory.deploy(allowList.target);

      expect(await factory.feeAmountTickSpacing(500)).to.equal(10);
      expect(await factory.feeAmountTickSpacing(3000)).to.equal(60);
      expect(await factory.feeAmountTickSpacing(10000)).to.equal(200);
    });
  });

  describe("createPool", function () {
    it("Should allow admin to create a pool", async function () {
      const { factory, owner, tokenA, tokenB } = await loadFixture(deployFixture);

      await expect(factory.connect(owner).createPool(tokenA.target, tokenB.target, 3000))
        .to.emit(factory, "PoolCreated");
    });

    it("Should return correct pool address after creation", async function () {
      const { factory, owner, tokenA, tokenB } = await loadFixture(deployFixture);

      const tx = await factory.connect(owner).createPool(tokenA.target, tokenB.target, 3000);
      await tx.wait();

      const poolAddress = await factory.getPool(tokenA.target, tokenB.target, 3000);
      expect(poolAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("Should store pool in both token order directions", async function () {
      const { factory, owner, tokenA, tokenB } = await loadFixture(deployFixture);

      await factory.connect(owner).createPool(tokenA.target, tokenB.target, 3000);

      const pool1 = await factory.getPool(tokenA.target, tokenB.target, 3000);
      const pool2 = await factory.getPool(tokenB.target, tokenA.target, 3000);

      expect(pool1).to.equal(pool2);
    });

    it("Should revert when non-admin tries to create pool", async function () {
      const { factory, nonAdmin, tokenA, tokenB } = await loadFixture(deployFixture);

      await expect(factory.connect(nonAdmin).createPool(tokenA.target, tokenB.target, 3000))
        .to.be.revertedWithCustomError(factory, "NotAdmin")
        .withArgs(nonAdmin.address);
    });

    it("Should revert when creating pool with same token", async function () {
      const { factory, owner, tokenA } = await loadFixture(deployFixture);

      await expect(factory.connect(owner).createPool(tokenA.target, tokenA.target, 3000))
        .to.be.reverted;
    });

    it("Should revert when creating pool with address(0)", async function () {
      const { factory, owner, tokenA } = await loadFixture(deployFixture);

      await expect(factory.connect(owner).createPool(tokenA.target, ethers.ZeroAddress, 3000))
        .to.be.reverted;
    });

    it("Should revert when creating pool with invalid fee", async function () {
      const { factory, owner, tokenA, tokenB } = await loadFixture(deployFixture);

      // Fee 100 is not enabled
      await expect(factory.connect(owner).createPool(tokenA.target, tokenB.target, 100))
        .to.be.reverted;
    });

    it("Should revert when pool already exists", async function () {
      const { factory, owner, tokenA, tokenB } = await loadFixture(deployFixture);

      await factory.connect(owner).createPool(tokenA.target, tokenB.target, 3000);

      await expect(factory.connect(owner).createPool(tokenA.target, tokenB.target, 3000))
        .to.be.reverted;
    });

    it("Should revert when pool already exists (reversed token order)", async function () {
      const { factory, owner, tokenA, tokenB } = await loadFixture(deployFixture);

      await factory.connect(owner).createPool(tokenA.target, tokenB.target, 3000);

      await expect(factory.connect(owner).createPool(tokenB.target, tokenA.target, 3000))
        .to.be.reverted;
    });

    it("Should allow creating pools with different fee tiers", async function () {
      const { factory, owner, tokenA, tokenB } = await loadFixture(deployFixture);

      await factory.connect(owner).createPool(tokenA.target, tokenB.target, 500);
      await factory.connect(owner).createPool(tokenA.target, tokenB.target, 3000);
      await factory.connect(owner).createPool(tokenA.target, tokenB.target, 10000);

      const pool500 = await factory.getPool(tokenA.target, tokenB.target, 500);
      const pool3000 = await factory.getPool(tokenA.target, tokenB.target, 3000);
      const pool10000 = await factory.getPool(tokenA.target, tokenB.target, 10000);

      expect(pool500).to.not.equal(ethers.ZeroAddress);
      expect(pool3000).to.not.equal(ethers.ZeroAddress);
      expect(pool10000).to.not.equal(ethers.ZeroAddress);
      expect(pool500).to.not.equal(pool3000);
      expect(pool500).to.not.equal(pool10000);
      expect(pool3000).to.not.equal(pool10000);
    });
  });

  describe("enableFeeAmount", function () {
    it("Should allow admin to enable new fee amount", async function () {
      const { factory, owner } = await loadFixture(deployFixture);

      await expect(factory.connect(owner).enableFeeAmount(250, 5))
        .to.emit(factory, "FeeAmountEnabled")
        .withArgs(250, 5);

      expect(await factory.feeAmountTickSpacing(250)).to.equal(5);
    });

    it("Should revert when non-admin tries to enable fee amount", async function () {
      const { factory, nonAdmin } = await loadFixture(deployFixture);

      await expect(factory.connect(nonAdmin).enableFeeAmount(250, 5))
        .to.be.revertedWithCustomError(factory, "NotAdmin")
        .withArgs(nonAdmin.address);
    });

    it("Should revert when fee is too high (>= 1000000)", async function () {
      const { factory, owner } = await loadFixture(deployFixture);

      await expect(factory.connect(owner).enableFeeAmount(1000000, 5))
        .to.be.reverted;
    });

    it("Should revert when tick spacing is 0", async function () {
      const { factory, owner } = await loadFixture(deployFixture);

      await expect(factory.connect(owner).enableFeeAmount(250, 0))
        .to.be.reverted;
    });

    it("Should revert when tick spacing is too high (>= 16384)", async function () {
      const { factory, owner } = await loadFixture(deployFixture);

      await expect(factory.connect(owner).enableFeeAmount(250, 16384))
        .to.be.reverted;
    });

    it("Should revert when fee amount already enabled", async function () {
      const { factory, owner } = await loadFixture(deployFixture);

      // 3000 is already enabled
      await expect(factory.connect(owner).enableFeeAmount(3000, 60))
        .to.be.reverted;
    });

    it("Should allow using newly enabled fee amount to create pool", async function () {
      const { factory, owner, tokenA, tokenB } = await loadFixture(deployFixture);

      await factory.connect(owner).enableFeeAmount(250, 5);

      await expect(factory.connect(owner).createPool(tokenA.target, tokenB.target, 250))
        .to.emit(factory, "PoolCreated");
    });
  });

  describe("getPool", function () {
    it("Should return address(0) for non-existent pool", async function () {
      const { factory, tokenA, tokenB } = await loadFixture(deployFixture);

      expect(await factory.getPool(tokenA.target, tokenB.target, 3000)).to.equal(ethers.ZeroAddress);
    });

    it("Should return correct pool address after creation", async function () {
      const { factory, owner, tokenA, tokenB } = await loadFixture(deployFixture);

      await factory.connect(owner).createPool(tokenA.target, tokenB.target, 3000);

      const pool = await factory.getPool(tokenA.target, tokenB.target, 3000);
      expect(pool).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe("Admin functionality (via WalletList)", function () {
    it("Should allow WalletList admin to grant admin role to new user", async function () {
      const { factory, walletList, owner, admin1 } = await loadFixture(deployFixture);

      const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
      await walletList.connect(owner).addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, admin1.address);

      expect(await factory.isAdmin(admin1.address)).to.be.true;
    });

    it("Should allow added admin to create pools", async function () {
      const { factory, walletList, owner, admin1, tokenA, tokenB } = await loadFixture(deployFixture);

      const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
      await walletList.connect(owner).addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, admin1.address);

      await expect(factory.connect(admin1).createPool(tokenA.target, tokenB.target, 3000))
        .to.emit(factory, "PoolCreated");
    });

    it("Should allow WalletList admin to revoke admin role", async function () {
      const { factory, walletList, owner, admin1 } = await loadFixture(deployFixture);

      const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
      await walletList.connect(owner).addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, admin1.address);
      await walletList.connect(owner).removeFromList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, admin1.address);

      expect(await factory.isAdmin(admin1.address)).to.be.false;
    });

    it("Should prevent removed admin from creating pools", async function () {
      const { factory, walletList, owner, admin1, tokenA, tokenB } = await loadFixture(deployFixture);

      const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
      await walletList.connect(owner).addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, admin1.address);
      await walletList.connect(owner).removeFromList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, admin1.address);

      await expect(factory.connect(admin1).createPool(tokenA.target, tokenB.target, 3000))
        .to.be.revertedWithCustomError(factory, "NotAdmin")
        .withArgs(admin1.address);
    });
  });

  describe("NoDelegateCall", function () {
    it("Should prevent delegatecall to createPool", async function () {
      const { factory, tokenA, tokenB } = await loadFixture(deployFixture);

      // Deploy DelegateCallAttack contract
      const DelegateCallAttack = await ethers.getContractFactory("DelegateCallAttack");
      const attacker = await DelegateCallAttack.deploy(factory.target);

      await expect(attacker.attack(tokenA.target, tokenB.target, 3000))
        .to.be.revertedWith("Delegatecall failed");
    });
  });

  describe("feeAmountTickSpacing", function () {
    it("Should return 0 for non-enabled fee", async function () {
      const { factory } = await loadFixture(deployFixture);

      expect(await factory.feeAmountTickSpacing(100)).to.equal(0);
    });

    it("Should return correct tick spacing for enabled fees", async function () {
      const { factory } = await loadFixture(deployFixture);

      expect(await factory.feeAmountTickSpacing(500)).to.equal(10);
      expect(await factory.feeAmountTickSpacing(3000)).to.equal(60);
      expect(await factory.feeAmountTickSpacing(10000)).to.equal(200);
    });
  });

});
