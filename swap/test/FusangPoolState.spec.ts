// @ts-nocheck - Hardhat contracts use dynamic methods not typed in BaseContract
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("FusangPoolState", function () {
  async function deployFixture() {
    const [admin, admin2, nonAdmin, pool1, pool2] = await ethers.getSigners();

    // Deploy WalletList contract for admin role management
    const WalletList = await ethers.getContractFactory("WalletList");
    const walletList = await WalletList.deploy();

    // Deploy FusangAllowList (uses walletList for admin)
    const FusangAllowList = await ethers.getContractFactory("FusangAllowList");
    const allowList = await FusangAllowList.deploy(walletList.target);

    // Deploy FusangFactory contract with allowList
    const FusangFactory = await ethers.getContractFactory("FusangFactory");
    const factory = await FusangFactory.deploy(allowList.target);

    // Deploy FusangPoolState contract
    const FusangPoolState = await ethers.getContractFactory("FusangPoolState");
    const poolState = await FusangPoolState.deploy(factory.target);

    // Add admin2 as admin via WalletList
    const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
    await walletList.addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, admin2.address);

    return { factory, walletList, poolState, admin, admin2, nonAdmin, pool1, pool2 };
  }

  describe("Deployment", function () {
    it("Should set factory address", async function () {
      const { poolState, factory } = await loadFixture(deployFixture);

      expect(await poolState.factory()).to.equal(factory.target);
    });

    it("Should have no pools paused initially", async function () {
      const { poolState, pool1 } = await loadFixture(deployFixture);

      expect(await poolState.isPoolPaused(pool1.address)).to.be.false;
    });

    it("Should have no pool close dates initially", async function () {
      const { poolState, pool1 } = await loadFixture(deployFixture);

      expect(await poolState.poolCloseDate(pool1.address)).to.equal(0);
    });
  });

  describe("setPoolCloseDate", function () {
    it("Should allow admin to set pool close date", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      const closeDate = (await time.latest()) + 86400; // 1 day in future
      await poolState.connect(admin).setPoolCloseDate(pool1.address, closeDate);

      expect(await poolState.poolCloseDate(pool1.address)).to.equal(closeDate);
    });

    it("Should emit PoolCloseDateSet event", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      const closeDate = (await time.latest()) + 86400;
      await expect(poolState.connect(admin).setPoolCloseDate(pool1.address, closeDate))
        .to.emit(poolState, "PoolCloseDateSet")
        .withArgs(pool1.address, closeDate);
    });

    it("Should allow setting close date to 0 (removing close date)", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      // Set a close date
      const closeDate = (await time.latest()) + 86400;
      await poolState.connect(admin).setPoolCloseDate(pool1.address, closeDate);

      // Remove the close date
      await poolState.connect(admin).setPoolCloseDate(pool1.address, 0);

      expect(await poolState.poolCloseDate(pool1.address)).to.equal(0);
    });

    it("Should allow setting close date to past (immediately closes pool)", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      const pastDate = (await time.latest()) - 86400; // 1 day in past
      await poolState.connect(admin).setPoolCloseDate(pool1.address, pastDate);

      expect(await poolState.poolCloseDate(pool1.address)).to.equal(pastDate);
      expect(await poolState.isPoolActive(pool1.address)).to.be.false;
    });

    it("Should revert when non-admin tries to set close date", async function () {
      const { poolState, nonAdmin, pool1 } = await loadFixture(deployFixture);

      const closeDate = (await time.latest()) + 86400;
      await expect(poolState.connect(nonAdmin).setPoolCloseDate(pool1.address, closeDate))
        .to.be.revertedWithCustomError(poolState, "NotAdmin")
        .withArgs(nonAdmin.address);
    });

    it("Should allow admin2 (added via factory) to set close date", async function () {
      const { poolState, admin2, pool1 } = await loadFixture(deployFixture);

      const closeDate = (await time.latest()) + 86400;
      await poolState.connect(admin2).setPoolCloseDate(pool1.address, closeDate);

      expect(await poolState.poolCloseDate(pool1.address)).to.equal(closeDate);
    });

    it("Should allow updating close date", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      const closeDate1 = (await time.latest()) + 86400;
      await poolState.connect(admin).setPoolCloseDate(pool1.address, closeDate1);

      const closeDate2 = (await time.latest()) + 172800; // 2 days in future
      await poolState.connect(admin).setPoolCloseDate(pool1.address, closeDate2);

      expect(await poolState.poolCloseDate(pool1.address)).to.equal(closeDate2);
    });
  });

  describe("pausePool", function () {
    it("Should allow admin to pause pool", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      await poolState.connect(admin).pausePool(pool1.address);

      expect(await poolState.isPoolPaused(pool1.address)).to.be.true;
    });

    it("Should emit PoolPaused event", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      await expect(poolState.connect(admin).pausePool(pool1.address))
        .to.emit(poolState, "PoolPaused")
        .withArgs(pool1.address);
    });

    it("Should revert when non-admin tries to pause pool", async function () {
      const { poolState, nonAdmin, pool1 } = await loadFixture(deployFixture);

      await expect(poolState.connect(nonAdmin).pausePool(pool1.address))
        .to.be.revertedWithCustomError(poolState, "NotAdmin")
        .withArgs(nonAdmin.address);
    });

    it("Should revert when trying to pause already paused pool", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      await poolState.connect(admin).pausePool(pool1.address);

      await expect(poolState.connect(admin).pausePool(pool1.address))
        .to.be.revertedWithCustomError(poolState, "PoolAlreadyPaused")
        .withArgs(pool1.address);
    });

    it("Should allow pausing multiple pools", async function () {
      const { poolState, admin, pool1, pool2 } = await loadFixture(deployFixture);

      await poolState.connect(admin).pausePool(pool1.address);
      await poolState.connect(admin).pausePool(pool2.address);

      expect(await poolState.isPoolPaused(pool1.address)).to.be.true;
      expect(await poolState.isPoolPaused(pool2.address)).to.be.true;
    });
  });

  describe("unpausePool", function () {
    it("Should allow admin to unpause pool", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      await poolState.connect(admin).pausePool(pool1.address);
      await poolState.connect(admin).unpausePool(pool1.address);

      expect(await poolState.isPoolPaused(pool1.address)).to.be.false;
    });

    it("Should emit PoolUnpaused event", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      await poolState.connect(admin).pausePool(pool1.address);

      await expect(poolState.connect(admin).unpausePool(pool1.address))
        .to.emit(poolState, "PoolUnpaused")
        .withArgs(pool1.address);
    });

    it("Should revert when non-admin tries to unpause pool", async function () {
      const { poolState, admin, nonAdmin, pool1 } = await loadFixture(deployFixture);

      await poolState.connect(admin).pausePool(pool1.address);

      await expect(poolState.connect(nonAdmin).unpausePool(pool1.address))
        .to.be.revertedWithCustomError(poolState, "NotAdmin")
        .withArgs(nonAdmin.address);
    });

    it("Should revert when trying to unpause non-paused pool", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      await expect(poolState.connect(admin).unpausePool(pool1.address))
        .to.be.revertedWithCustomError(poolState, "PoolNotPaused")
        .withArgs(pool1.address);
    });
  });

  describe("isPoolActive", function () {
    it("Should return true for pool that is not paused and has no close date", async function () {
      const { poolState, pool1 } = await loadFixture(deployFixture);

      expect(await poolState.isPoolActive(pool1.address)).to.be.true;
    });

    it("Should return false for paused pool", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      await poolState.connect(admin).pausePool(pool1.address);

      expect(await poolState.isPoolActive(pool1.address)).to.be.false;
    });

    it("Should return true for pool with future close date", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      const futureDate = (await time.latest()) + 86400; // 1 day in future
      await poolState.connect(admin).setPoolCloseDate(pool1.address, futureDate);

      expect(await poolState.isPoolActive(pool1.address)).to.be.true;
    });

    it("Should return false for pool with past close date", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      const pastDate = (await time.latest()) - 86400; // 1 day in past
      await poolState.connect(admin).setPoolCloseDate(pool1.address, pastDate);

      expect(await poolState.isPoolActive(pool1.address)).to.be.false;
    });

    it("Should return false when close date equals current timestamp", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      const currentTime = await time.latest();
      await poolState.connect(admin).setPoolCloseDate(pool1.address, currentTime);

      // Advance time by 1 second to ensure we're at or past the close date
      await time.increase(1);

      expect(await poolState.isPoolActive(pool1.address)).to.be.false;
    });

    it("Should return false for paused pool even with future close date", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      const futureDate = (await time.latest()) + 86400;
      await poolState.connect(admin).setPoolCloseDate(pool1.address, futureDate);
      await poolState.connect(admin).pausePool(pool1.address);

      expect(await poolState.isPoolActive(pool1.address)).to.be.false;
    });

    it("Should return true after unpausing", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      await poolState.connect(admin).pausePool(pool1.address);
      await poolState.connect(admin).unpausePool(pool1.address);

      expect(await poolState.isPoolActive(pool1.address)).to.be.true;
    });

    it("Should return true after removing close date", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      const pastDate = (await time.latest()) - 86400;
      await poolState.connect(admin).setPoolCloseDate(pool1.address, pastDate);
      expect(await poolState.isPoolActive(pool1.address)).to.be.false;

      // Remove close date
      await poolState.connect(admin).setPoolCloseDate(pool1.address, 0);
      expect(await poolState.isPoolActive(pool1.address)).to.be.true;
    });
  });

  describe("isPoolPaused", function () {
    it("Should return false for non-paused pool", async function () {
      const { poolState, pool1 } = await loadFixture(deployFixture);

      expect(await poolState.isPoolPaused(pool1.address)).to.be.false;
    });

    it("Should return true for paused pool", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      await poolState.connect(admin).pausePool(pool1.address);

      expect(await poolState.isPoolPaused(pool1.address)).to.be.true;
    });

    it("Should return false after unpausing", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      await poolState.connect(admin).pausePool(pool1.address);
      await poolState.connect(admin).unpausePool(pool1.address);

      expect(await poolState.isPoolPaused(pool1.address)).to.be.false;
    });
  });

  describe("poolCloseDate", function () {
    it("Should return 0 for pool with no close date", async function () {
      const { poolState, pool1 } = await loadFixture(deployFixture);

      expect(await poolState.poolCloseDate(pool1.address)).to.equal(0);
    });

    it("Should return correct close date after setting", async function () {
      const { poolState, admin, pool1 } = await loadFixture(deployFixture);

      const closeDate = (await time.latest()) + 86400;
      await poolState.connect(admin).setPoolCloseDate(pool1.address, closeDate);

      expect(await poolState.poolCloseDate(pool1.address)).to.equal(closeDate);
    });
  });

  describe("onlyAdmin modifier", function () {
    it("Should use factory's isAdmin for access control", async function () {
      const { factory, poolState, admin, admin2, nonAdmin, pool1 } = await loadFixture(deployFixture);

      // admin (deployer) should be admin
      expect(await factory.isAdmin(admin.address)).to.be.true;
      await expect(poolState.connect(admin).pausePool(pool1.address)).to.not.be.reverted;

      // admin2 (added) should be admin
      expect(await factory.isAdmin(admin2.address)).to.be.true;
      await expect(poolState.connect(admin2).unpausePool(pool1.address)).to.not.be.reverted;

      // nonAdmin should not be admin
      expect(await factory.isAdmin(nonAdmin.address)).to.be.false;
      await expect(poolState.connect(nonAdmin).pausePool(pool1.address))
        .to.be.revertedWithCustomError(poolState, "NotAdmin");
    });

    it("Should update access when admin is removed from factory", async function () {
      const { walletList, poolState, admin, admin2, pool1 } = await loadFixture(deployFixture);

      // admin2 can pause
      await poolState.connect(admin2).pausePool(pool1.address);
      await poolState.connect(admin2).unpausePool(pool1.address);

      // Remove admin2 from WalletList
      const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE();
      await walletList.connect(admin).removeFromList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, admin2.address);

      // admin2 should no longer be able to pause
      await expect(poolState.connect(admin2).pausePool(pool1.address))
        .to.be.revertedWithCustomError(poolState, "NotAdmin");
    });
  });
});
