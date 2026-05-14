// @ts-nocheck - Hardhat contracts use dynamic methods not typed in BaseContract
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";


const WHITELIST = ethers.keccak256(ethers.toUtf8Bytes("WHITELIST"));
const BLACKLIST = ethers.keccak256(ethers.toUtf8Bytes("BLACKLIST"));
const FROZENLIST = ethers.keccak256(ethers.toUtf8Bytes("FROZENLIST"));
const MEMBER = ethers.keccak256(ethers.toUtf8Bytes("MEMBER"));
const DEFAULT_ADMIN_ROLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("FusangAccessControl", function () {
  async function deployFixture() {
    const [admin, whitelistedUser, blacklistedUser, frozenUser, nonWhitelistedUser, pool1] =
      await ethers.getSigners();

    // Deploy WalletList contract
    const WalletListFactory = await ethers.getContractFactory("WalletList");
    const walletList = await WalletListFactory.deploy();

    // Deploy FusangAllowList (uses walletList for admin)
    const FusangAllowList = await ethers.getContractFactory("FusangAllowList");
    const allowList = await FusangAllowList.deploy(walletList.target);

    // Deploy FusangFactory with allowList
    const FusangFactory = await ethers.getContractFactory("FusangFactory");
    const factory = await FusangFactory.deploy(allowList.target);

    // Deploy FusangPoolState
    const FusangPoolState = await ethers.getContractFactory("FusangPoolState");
    const poolState = await FusangPoolState.deploy(factory.target);

    // Deploy FusangAccessControlTest (test harness)
    const FusangAccessControlTest = await ethers.getContractFactory("FusangAccessControlTest");
    const accessControl = await FusangAccessControlTest.deploy(
      factory.target,
      poolState.target
    );

    // Configure WalletList
    await walletList.setRoleManageList(BLACKLIST, DEFAULT_ADMIN_ROLE, true);
    await walletList.setRoleManageList(FROZENLIST, DEFAULT_ADMIN_ROLE, true);
    await walletList.addToList(MEMBER, DEFAULT_ADMIN_ROLE, admin.address);

    // Add whitelistedUser to whitelist
    await walletList.addToList(WHITELIST, MEMBER, whitelistedUser.address);
    await walletList.addToList(WHITELIST, MEMBER, admin.address);

    // Add blacklistedUser to whitelist first, then blacklist
    await walletList.addToList(WHITELIST, MEMBER, blacklistedUser.address);
    await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, blacklistedUser.address);

    // Add frozenUser to whitelist first, then frozenlist
    await walletList.addToList(WHITELIST, MEMBER, frozenUser.address);
    await walletList.addToList(FROZENLIST, DEFAULT_ADMIN_ROLE, frozenUser.address);

    return {
      accessControl,
      walletList,
      allowList,
      poolState,
      factory,
      admin,
      whitelistedUser,
      blacklistedUser,
      frozenUser,
      nonWhitelistedUser,
      pool1,
    };
  }

  describe("Deployment", function () {
    it("Should set factoryContract address", async function () {
      const { accessControl, factory } = await loadFixture(deployFixture);

      expect(await accessControl.factoryContract()).to.equal(factory.target);
    });

    it("Should set poolStateContract address", async function () {
      const { accessControl, poolState } = await loadFixture(deployFixture);

      expect(await accessControl.poolStateContract()).to.equal(poolState.target);
    });

    it("Should have correct constant values", async function () {
      const { accessControl } = await loadFixture(deployFixture);

      expect(await accessControl.WHITELIST()).to.equal(WHITELIST);
      expect(await accessControl.BLACKLIST()).to.equal(BLACKLIST);
      expect(await accessControl.FROZENLIST()).to.equal(FROZENLIST);
    });
  });

  describe("canSwap", function () {
    it("Should return true for whitelisted user", async function () {
      const { accessControl, whitelistedUser } = await loadFixture(deployFixture);

      expect(await accessControl.canSwap(whitelistedUser.address)).to.be.true;
    });

    it("Should return false for non-whitelisted user", async function () {
      const { accessControl, nonWhitelistedUser } = await loadFixture(deployFixture);

      expect(await accessControl.canSwap(nonWhitelistedUser.address)).to.be.false;
    });

    it("Should return false for blacklisted user (even if whitelisted)", async function () {
      const { accessControl, blacklistedUser } = await loadFixture(deployFixture);

      expect(await accessControl.canSwap(blacklistedUser.address)).to.be.false;
    });

    it("Should return false for frozen user (even if whitelisted)", async function () {
      const { accessControl, frozenUser } = await loadFixture(deployFixture);

      expect(await accessControl.canSwap(frozenUser.address)).to.be.false;
    });

    it("Should return true for admin if whitelisted", async function () {
      const { accessControl, admin } = await loadFixture(deployFixture);

      expect(await accessControl.canSwap(admin.address)).to.be.true;
    });
  });

  describe("onlyAllowed modifier", function () {
    it("Should allow whitelisted user to call function", async function () {
      const { accessControl, whitelistedUser } = await loadFixture(deployFixture);

      // Function should execute without reverting for whitelisted user
      await expect(accessControl.connect(whitelistedUser).testOnlyAllowed())
        .to.not.be.reverted;
    });

    it("Should revert for non-whitelisted user", async function () {
      const { accessControl, nonWhitelistedUser } = await loadFixture(deployFixture);

      await expect(accessControl.connect(nonWhitelistedUser).testOnlyAllowed())
        .to.be.revertedWithCustomError(accessControl, "NotAllowedToSwap")
        .withArgs(nonWhitelistedUser.address);
    });

    it("Should revert for blacklisted user", async function () {
      const { accessControl, blacklistedUser } = await loadFixture(deployFixture);

      await expect(accessControl.connect(blacklistedUser).testOnlyAllowed())
        .to.be.revertedWithCustomError(accessControl, "NotAllowedToSwap")
        .withArgs(blacklistedUser.address);
    });

    it("Should revert for frozen user", async function () {
      const { accessControl, frozenUser } = await loadFixture(deployFixture);

      await expect(accessControl.connect(frozenUser).testOnlyAllowed())
        .to.be.revertedWithCustomError(accessControl, "NotAllowedToSwap")
        .withArgs(frozenUser.address);
    });
  });

  describe("_checkRecipientAllowed", function () {
    it("Should not revert for whitelisted recipient", async function () {
      const { accessControl, whitelistedUser } = await loadFixture(deployFixture);

      await expect(accessControl.testCheckRecipientAllowed(whitelistedUser.address))
        .to.not.be.reverted;
    });

    it("Should revert for address(0) recipient", async function () {
      const { accessControl } = await loadFixture(deployFixture);

      await expect(accessControl.testCheckRecipientAllowed(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(accessControl, "NotAllowedToSwap");
    });

    it("Should not revert for this contract as recipient", async function () {
      const { accessControl } = await loadFixture(deployFixture);

      await expect(accessControl.testCheckRecipientAllowed(accessControl.target))
        .to.not.be.reverted;
    });

    it("Should revert for non-whitelisted recipient", async function () {
      const { accessControl, nonWhitelistedUser } = await loadFixture(deployFixture);

      await expect(accessControl.testCheckRecipientAllowed(nonWhitelistedUser.address))
        .to.be.revertedWithCustomError(accessControl, "NotAllowedToSwap")
        .withArgs(nonWhitelistedUser.address);
    });

    it("Should revert for blacklisted recipient", async function () {
      const { accessControl, blacklistedUser } = await loadFixture(deployFixture);

      await expect(accessControl.testCheckRecipientAllowed(blacklistedUser.address))
        .to.be.revertedWithCustomError(accessControl, "NotAllowedToSwap")
        .withArgs(blacklistedUser.address);
    });

    it("Should revert for frozen recipient", async function () {
      const { accessControl, frozenUser } = await loadFixture(deployFixture);

      await expect(accessControl.testCheckRecipientAllowed(frozenUser.address))
        .to.be.revertedWithCustomError(accessControl, "NotAllowedToSwap")
        .withArgs(frozenUser.address);
    });
  });

  describe("_checkPoolActive", function () {
    it("Should not revert for active pool", async function () {
      const { accessControl, pool1 } = await loadFixture(deployFixture);

      await expect(accessControl.testCheckPoolActive(pool1.address))
        .to.not.be.reverted;
    });

    it("Should revert for paused pool", async function () {
      const { accessControl, poolState, admin, pool1 } = await loadFixture(deployFixture);

      await poolState.connect(admin).pausePool(pool1.address);

      await expect(accessControl.testCheckPoolActive(pool1.address))
        .to.be.revertedWithCustomError(accessControl, "PoolNotActive")
        .withArgs(pool1.address);
    });

    it("Should revert for closed pool (past close date)", async function () {
      const { accessControl, poolState, admin, pool1 } = await loadFixture(deployFixture);

      const pastDate = (await time.latest()) - 86400;
      await poolState.connect(admin).setPoolCloseDate(pool1.address, pastDate);

      await expect(accessControl.testCheckPoolActive(pool1.address))
        .to.be.revertedWithCustomError(accessControl, "PoolNotActive")
        .withArgs(pool1.address);
    });

    it("Should not revert for pool with future close date", async function () {
      const { accessControl, poolState, admin, pool1 } = await loadFixture(deployFixture);

      const futureDate = (await time.latest()) + 86400;
      await poolState.connect(admin).setPoolCloseDate(pool1.address, futureDate);

      await expect(accessControl.testCheckPoolActive(pool1.address))
        .to.not.be.reverted;
    });
  });

  describe("_checkPoolNotPaused", function () {
    it("Should not revert for non-paused pool", async function () {
      const { accessControl, pool1 } = await loadFixture(deployFixture);

      await expect(accessControl.testCheckPoolNotPaused(pool1.address))
        .to.not.be.reverted;
    });

    it("Should revert for paused pool", async function () {
      const { accessControl, poolState, admin, pool1 } = await loadFixture(deployFixture);

      await poolState.connect(admin).pausePool(pool1.address);

      await expect(accessControl.testCheckPoolNotPaused(pool1.address))
        .to.be.revertedWithCustomError(accessControl, "PoolIsPaused")
        .withArgs(pool1.address);
    });

    it("Should not revert for closed pool (only checks pause, not close date)", async function () {
      const { accessControl, poolState, admin, pool1 } = await loadFixture(deployFixture);

      const pastDate = (await time.latest()) - 86400;
      await poolState.connect(admin).setPoolCloseDate(pool1.address, pastDate);

      // Pool is closed but not paused, so _checkPoolNotPaused should pass
      await expect(accessControl.testCheckPoolNotPaused(pool1.address))
        .to.not.be.reverted;
    });
  });

  describe("Dynamic whitelist changes", function () {
    it("Should reflect whitelist addition immediately", async function () {
      const { accessControl, walletList, admin, nonWhitelistedUser } = await loadFixture(deployFixture);

      // Initially not allowed
      expect(await accessControl.canSwap(nonWhitelistedUser.address)).to.be.false;

      // Add to whitelist
      await walletList.addToList(WHITELIST, MEMBER, nonWhitelistedUser.address);

      // Now allowed
      expect(await accessControl.canSwap(nonWhitelistedUser.address)).to.be.true;
    });

    it("Should reflect whitelist removal immediately", async function () {
      const { accessControl, walletList, admin, whitelistedUser } = await loadFixture(deployFixture);

      // Initially allowed
      expect(await accessControl.canSwap(whitelistedUser.address)).to.be.true;

      // Remove from whitelist
      await walletList.removeFromList(WHITELIST, MEMBER, whitelistedUser.address);

      // Now not allowed
      expect(await accessControl.canSwap(whitelistedUser.address)).to.be.false;
    });

    it("Should reflect blacklist addition immediately", async function () {
      const { accessControl, walletList, admin, whitelistedUser } = await loadFixture(deployFixture);

      // Initially allowed
      expect(await accessControl.canSwap(whitelistedUser.address)).to.be.true;

      // Add to blacklist
      await walletList.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser.address);

      // Now not allowed
      expect(await accessControl.canSwap(whitelistedUser.address)).to.be.false;
    });

    it("Should reflect blacklist removal immediately", async function () {
      const { accessControl, walletList, admin, blacklistedUser } = await loadFixture(deployFixture);

      // Initially not allowed (blacklisted)
      expect(await accessControl.canSwap(blacklistedUser.address)).to.be.false;

      // Remove from blacklist
      await walletList.removeFromList(BLACKLIST, DEFAULT_ADMIN_ROLE, blacklistedUser.address);

      // Now allowed (still whitelisted)
      expect(await accessControl.canSwap(blacklistedUser.address)).to.be.true;
    });

    it("Should reflect frozen list addition immediately", async function () {
      const { accessControl, walletList, admin, whitelistedUser } = await loadFixture(deployFixture);

      // Initially allowed
      expect(await accessControl.canSwap(whitelistedUser.address)).to.be.true;

      // Add to frozen list
      await walletList.addToList(FROZENLIST, DEFAULT_ADMIN_ROLE, whitelistedUser.address);

      // Now not allowed
      expect(await accessControl.canSwap(whitelistedUser.address)).to.be.false;
    });

    it("Should reflect frozen list removal immediately", async function () {
      const { accessControl, walletList, admin, frozenUser } = await loadFixture(deployFixture);

      // Initially not allowed (frozen)
      expect(await accessControl.canSwap(frozenUser.address)).to.be.false;

      // Remove from frozen list
      await walletList.removeFromList(FROZENLIST, DEFAULT_ADMIN_ROLE, frozenUser.address);

      // Now allowed (still whitelisted)
      expect(await accessControl.canSwap(frozenUser.address)).to.be.true;
    });
  });

});
