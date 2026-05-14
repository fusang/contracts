// @ts-nocheck - Hardhat contracts use dynamic methods not typed in BaseContract
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("FusangAllowList", function () {
  async function deployFixture() {
    const [owner, user1, user2, nonAdmin] = await ethers.getSigners();

    // Deploy WalletList contract (for admin role management)
    const WalletList = await ethers.getContractFactory("WalletList");
    const walletList = await WalletList.deploy();

    // Deploy FusangAllowList contract (uses walletList for admin)
    const FusangAllowList = await ethers.getContractFactory("FusangAllowList");
    const allowList = await FusangAllowList.deploy(walletList.target);

    return { allowList, walletList, owner, user1, user2, nonAdmin };
  }

  describe("Deployment", function () {
    it("Should set walletList address", async function () {
      const { allowList, walletList } = await loadFixture(deployFixture);

      expect(await allowList.walletList()).to.equal(walletList.target);
    });

    it("Should set deployer as admin via WalletList", async function () {
      const { allowList, owner } = await loadFixture(deployFixture);

      expect(await allowList.isAdmin(owner.address)).to.be.true;
    });

    it("Should have no addresses allowed initially", async function () {
      const { allowList, user1 } = await loadFixture(deployFixture);

      expect(await allowList.isAllowed(user1.address)).to.be.false;
    });
  });

  describe("isAllowed", function () {
    it("Should return false for non-allowed addresses", async function () {
      const { allowList, user1, user2 } = await loadFixture(deployFixture);

      expect(await allowList.isAllowed(user1.address)).to.be.false;
      expect(await allowList.isAllowed(user2.address)).to.be.false;
    });

    it("Should return true for allowed addresses", async function () {
      const { allowList, owner, user1 } = await loadFixture(deployFixture);

      await allowList.connect(owner).setAllowed(user1.address, true);

      expect(await allowList.isAllowed(user1.address)).to.be.true;
    });

    it("Should return false for address(0)", async function () {
      const { allowList } = await loadFixture(deployFixture);

      expect(await allowList.isAllowed(ethers.ZeroAddress)).to.be.false;
    });
  });

  describe("setAllowed", function () {
    it("Should allow admin to set address as allowed", async function () {
      const { allowList, owner, user1 } = await loadFixture(deployFixture);

      await allowList.connect(owner).setAllowed(user1.address, true);

      expect(await allowList.isAllowed(user1.address)).to.be.true;
      expect(await allowList.allowed(user1.address)).to.be.true;
    });

    it("Should allow admin to remove address from allowed", async function () {
      const { allowList, owner, user1 } = await loadFixture(deployFixture);

      // Add to allowed
      await allowList.connect(owner).setAllowed(user1.address, true);
      expect(await allowList.isAllowed(user1.address)).to.be.true;

      // Remove from allowed
      await allowList.connect(owner).setAllowed(user1.address, false);
      expect(await allowList.isAllowed(user1.address)).to.be.false;
    });

    it("Should emit AllowedChanged event when setting allowed", async function () {
      const { allowList, owner, user1 } = await loadFixture(deployFixture);

      await expect(allowList.connect(owner).setAllowed(user1.address, true))
        .to.emit(allowList, "AllowedChanged")
        .withArgs(user1.address, true);
    });

    it("Should emit AllowedChanged event when removing from allowed", async function () {
      const { allowList, owner, user1 } = await loadFixture(deployFixture);

      // Add first
      await allowList.connect(owner).setAllowed(user1.address, true);

      // Remove and check event
      await expect(allowList.connect(owner).setAllowed(user1.address, false))
        .to.emit(allowList, "AllowedChanged")
        .withArgs(user1.address, false);
    });

    it("Should revert when non-admin tries to set allowed", async function () {
      const { allowList, nonAdmin, user1 } = await loadFixture(deployFixture);

      await expect(allowList.connect(nonAdmin).setAllowed(user1.address, true))
        .to.be.revertedWithCustomError(allowList, "NotAdmin")
        .withArgs(nonAdmin.address);
    });

    it("Should allow setting multiple addresses as allowed", async function () {
      const { allowList, owner, user1, user2 } = await loadFixture(deployFixture);

      await allowList.connect(owner).setAllowed(user1.address, true);
      await allowList.connect(owner).setAllowed(user2.address, true);

      expect(await allowList.isAllowed(user1.address)).to.be.true;
      expect(await allowList.isAllowed(user2.address)).to.be.true;
    });

    it("Should allow setting same address multiple times with same value", async function () {
      const { allowList, owner, user1 } = await loadFixture(deployFixture);

      await allowList.connect(owner).setAllowed(user1.address, true);
      await allowList.connect(owner).setAllowed(user1.address, true);

      expect(await allowList.isAllowed(user1.address)).to.be.true;
    });

    it("Should handle setting false for non-allowed address", async function () {
      const { allowList, owner, user1 } = await loadFixture(deployFixture);

      // Set false for address that was never allowed
      await expect(allowList.connect(owner).setAllowed(user1.address, false))
        .to.emit(allowList, "AllowedChanged")
        .withArgs(user1.address, false);

      expect(await allowList.isAllowed(user1.address)).to.be.false;
    });
  });

  describe("allowed mapping", function () {
    it("Should return correct value from allowed mapping", async function () {
      const { allowList, owner, user1 } = await loadFixture(deployFixture);

      // Initially false
      expect(await allowList.allowed(user1.address)).to.be.false;

      // Set to true
      await allowList.connect(owner).setAllowed(user1.address, true);
      expect(await allowList.allowed(user1.address)).to.be.true;

      // Set to false
      await allowList.connect(owner).setAllowed(user1.address, false);
      expect(await allowList.allowed(user1.address)).to.be.false;
    });
  });

  describe("batchSetAllowed", function () {
    it("Should allow admin to batch set multiple addresses as allowed", async function () {
      const { allowList, owner, user1, user2, nonAdmin } = await loadFixture(deployFixture);

      await allowList.connect(owner).batchSetAllowed([user1.address, user2.address, nonAdmin.address], true);

      expect(await allowList.isAllowed(user1.address)).to.be.true;
      expect(await allowList.isAllowed(user2.address)).to.be.true;
      expect(await allowList.isAllowed(nonAdmin.address)).to.be.true;
    });

    it("Should allow admin to batch remove multiple addresses from allowed", async function () {
      const { allowList, owner, user1, user2 } = await loadFixture(deployFixture);

      // Add first
      await allowList.connect(owner).batchSetAllowed([user1.address, user2.address], true);
      expect(await allowList.isAllowed(user1.address)).to.be.true;
      expect(await allowList.isAllowed(user2.address)).to.be.true;

      // Remove
      await allowList.connect(owner).batchSetAllowed([user1.address, user2.address], false);
      expect(await allowList.isAllowed(user1.address)).to.be.false;
      expect(await allowList.isAllowed(user2.address)).to.be.false;
    });

    it("Should emit AllowedChanged event for each address", async function () {
      const { allowList, owner, user1, user2 } = await loadFixture(deployFixture);

      await expect(allowList.connect(owner).batchSetAllowed([user1.address, user2.address], true))
        .to.emit(allowList, "AllowedChanged")
        .withArgs(user1.address, true)
        .and.to.emit(allowList, "AllowedChanged")
        .withArgs(user2.address, true);
    });

    it("Should revert when non-admin tries to batch set allowed", async function () {
      const { allowList, nonAdmin, user1, user2 } = await loadFixture(deployFixture);

      await expect(allowList.connect(nonAdmin).batchSetAllowed([user1.address, user2.address], true))
        .to.be.revertedWithCustomError(allowList, "NotAdmin")
        .withArgs(nonAdmin.address);
    });

    it("Should handle empty array", async function () {
      const { allowList, owner } = await loadFixture(deployFixture);

      await expect(allowList.connect(owner).batchSetAllowed([], true)).to.not.be.reverted;
    });

    it("Should handle single address in array", async function () {
      const { allowList, owner, user1 } = await loadFixture(deployFixture);

      await allowList.connect(owner).batchSetAllowed([user1.address], true);

      expect(await allowList.isAllowed(user1.address)).to.be.true;
    });
  });

  describe("setWalletList", function () {
    it("Should allow admin to update walletList", async function () {
      const { allowList, owner } = await loadFixture(deployFixture);

      const WalletList = await ethers.getContractFactory("WalletList");
      const newWalletList = await WalletList.deploy();

      await allowList.connect(owner).setWalletList(newWalletList.target);

      expect(await allowList.walletList()).to.equal(newWalletList.target);
    });

    it("Should revert when non-admin tries to update walletList", async function () {
      const { allowList, nonAdmin } = await loadFixture(deployFixture);

      await expect(allowList.connect(nonAdmin).setWalletList(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(allowList, "NotAdmin")
        .withArgs(nonAdmin.address);
    });

    it("Should use new walletList for admin checks after update", async function () {
      const { allowList, owner, user1 } = await loadFixture(deployFixture);

      // Deploy new WalletList with user1 as admin
      const WalletList = await ethers.getContractFactory("WalletList");
      const newWalletList = await WalletList.connect(user1).deploy();

      // Update walletList
      await allowList.connect(owner).setWalletList(newWalletList.target);

      // user1 is admin in new WalletList (deployer)
      expect(await allowList.isAdmin(user1.address)).to.be.true;
      // owner is no longer admin (not in new WalletList)
      expect(await allowList.isAdmin(owner.address)).to.be.false;
    });

    it("Should emit WalletListChanged event with old and new addresses", async function () {
      const { allowList, walletList, owner } = await loadFixture(deployFixture);

      const WalletList = await ethers.getContractFactory("WalletList");
      const newWalletList = await WalletList.deploy();

      await expect(allowList.connect(owner).setWalletList(newWalletList.target))
        .to.emit(allowList, "WalletListChanged")
        .withArgs(walletList.target, newWalletList.target);
    });

    it("Should revert when setting walletList to address(0)", async function () {
      const { allowList, owner } = await loadFixture(deployFixture);

      await expect(allowList.connect(owner).setWalletList(ethers.ZeroAddress))
        .to.be.reverted;
    });
  });

  describe("isAdmin", function () {
    it("Should return true for WalletList admin", async function () {
      const { allowList, owner } = await loadFixture(deployFixture);

      expect(await allowList.isAdmin(owner.address)).to.be.true;
    });

    it("Should return false for non-admin", async function () {
      const { allowList, nonAdmin } = await loadFixture(deployFixture);

      expect(await allowList.isAdmin(nonAdmin.address)).to.be.false;
    });

    it("Should allow new admin to set allowed after being granted admin role", async function () {
      const { allowList, walletList, owner, user1, user2 } = await loadFixture(deployFixture);

      // Grant admin role to user1
      const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
      await walletList.connect(owner).addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, user1.address);

      // New admin should be able to set allowed
      await expect(allowList.connect(user1).setAllowed(user2.address, true))
        .to.not.be.reverted;

      expect(await allowList.isAllowed(user2.address)).to.be.true;
    });

    it("Should prevent setting allowed after admin role is revoked", async function () {
      const { allowList, walletList, owner, user1, user2 } = await loadFixture(deployFixture);

      // Grant admin role to user1
      const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
      await walletList.connect(owner).addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, user1.address);

      // User1 can set allowed
      await allowList.connect(user1).setAllowed(user2.address, true);
      expect(await allowList.isAllowed(user2.address)).to.be.true;

      // Revoke admin role from user1
      await walletList.connect(owner).removeFromList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, user1.address);

      // User1 should not be able to set allowed anymore
      await expect(allowList.connect(user1).setAllowed(user2.address, false))
        .to.be.revertedWithCustomError(allowList, "NotAdmin")
        .withArgs(user1.address);
    });
  });
});
