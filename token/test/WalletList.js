const { expect } = require('chai')
const { ethers, network } = require('hardhat')
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const FROZENLIST = ethers.keccak256(ethers.toUtf8Bytes('FROZENLIST'))
const MEMBER = ethers.keccak256(ethers.toUtf8Bytes('MEMBER'))
const WHITELIST = ethers.keccak256(ethers.toUtf8Bytes('WHITELIST'))
const BLACKLIST = ethers.keccak256(ethers.toUtf8Bytes('BLACKLIST'))
const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'

describe('WalletList Access Control', function () {
  async function deploy() {
    const [admin, member, anotherMember, user, user1] = await ethers.getSigners()
    // Deploy AddressWhitelist
    const walletListFactory = await ethers.getContractFactory('WalletList')
    const walletListContract = await walletListFactory.deploy()
    await walletListContract.addToList(MEMBER, DEFAULT_ADMIN_ROLE, member.address)
    await walletListContract.addToList(MEMBER, DEFAULT_ADMIN_ROLE, anotherMember.address)
    return { admin, member, anotherMember, user, user1, walletListContract }
  }

  describe('AddressList', function () {
    it('Member are not able to add/remove to/from a list without having access to manage a list', async function () {
      const { member, user, walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.connect(member).addToList(ethers.encodeBytes32String('whitelist_test'), MEMBER, user.address)).to.be.revertedWithCustomError(
        walletListContract,
        'NoPermission',
      )
    })

    it('User are not able to add/remove to/from a list without having member roles', async function () {
      const { user, walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.connect(user).addToList(WHITELIST, MEMBER, user.address)).to.be.revertedWithCustomError(walletListContract, 'NoPermission')
    })

    it('Member are able to add/remove to/from a list with having access to manage a list', async function () {
      const { member, user, walletListContract, admin } = await loadFixture(deploy)
      expect(await walletListContract.roleManageList(WHITELIST, MEMBER)).to.equal(true)
      await walletListContract.connect(member).addToList(WHITELIST, MEMBER, user.address)
      expect(await walletListContract.isAddressInList(WHITELIST, user.address)).to.equal(true)
      expect(await walletListContract.addressList(WHITELIST, user.address)).to.equal(member.address)
    })

    it('Add/Remove to/from a list by owner', async function () {
      const { admin, member, user, user1, walletListContract } = await loadFixture(deploy)
      await walletListContract.connect(admin).batchAddToListByAdmin(WHITELIST, MEMBER, [user.address, user1.address], member.address)
      expect(await walletListContract.isAddressInList(WHITELIST, user.address)).to.be.true
      expect(await walletListContract.isAddressInList(WHITELIST, user1.address)).to.be.true
      expect(await walletListContract.addressList(WHITELIST, user.address)).to.equal(member.address)
      expect(await walletListContract.addressList(WHITELIST, user1.address)).to.equal(member.address)

      await walletListContract.connect(admin).batchRemoveFromListByAdmin(WHITELIST, MEMBER, [user.address, user1.address], member.address)
      expect(await walletListContract.isAddressInList(WHITELIST, user.address)).to.be.false
      expect(await walletListContract.isAddressInList(WHITELIST, user1.address)).to.be.false
      expect(await walletListContract.addressList(WHITELIST, user.address)).to.equal(ethers.ZeroAddress)
      expect(await walletListContract.addressList(WHITELIST, user1.address)).to.equal(ethers.ZeroAddress)
    })

    it('batchRemoveFromListByAdmin reverts if user not listed', async function () {
      const { admin, user, walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.connect(admin).batchRemoveFromListByAdmin(WHITELIST, MEMBER, [user.address], admin.address)).to.be.revertedWithCustomError(
        walletListContract,
        'NotListed',
      )
    })
    it('Only Admin can call owner function', async function () {
      const { member, user, walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.connect(member).batchAddToListByAdmin(WHITELIST, MEMBER, [user.address], member.address)).to.be.revertedWithCustomError(
        walletListContract,
        'NotAdmin',
      )
      await expect(walletListContract.connect(member).batchRemoveFromListByAdmin(WHITELIST, MEMBER, [user.address], member.address)).to.be.revertedWithCustomError(
        walletListContract,
        'NotAdmin',
      )
      await expect(walletListContract.connect(member).setRoleManageList(WHITELIST, MEMBER, true)).to.be.revertedWithCustomError(walletListContract, 'NotAdmin')
    })

    it('Already listed user could not be listed again', async function () {
      const { member, user, walletListContract } = await loadFixture(deploy)
      await walletListContract.connect(member).addToList(WHITELIST, MEMBER, user.address)
      await expect(walletListContract.connect(member).addToList(WHITELIST, MEMBER, user.address)).to.be.revertedWithCustomError(walletListContract, 'AlreadyListed')
    })

    it('Only listed user can be removed', async function () {
      const { member, user, walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.connect(member).removeFromList(WHITELIST, MEMBER, user.address)).to.be.revertedWithCustomError(walletListContract, 'NotListed')
    })

    it('Only correct member can remove', async function () {
      const { member, anotherMember, user, walletListContract } = await loadFixture(deploy)
      await walletListContract.connect(member).addToList(WHITELIST, MEMBER, user.address)
      await expect(walletListContract.connect(anotherMember).removeFromList(WHITELIST, MEMBER, user.address)).to.be.revertedWithCustomError(walletListContract, 'NoPermission')
    })

    it('Batch add to list', async function () {
      const { member, user, user1, walletListContract } = await loadFixture(deploy)
      await walletListContract.connect(member).batchAddToList(WHITELIST, MEMBER, [user.address, user1.address])
      expect(await walletListContract.isAddressInList(WHITELIST, user.address)).to.be.true
      expect(await walletListContract.isAddressInList(WHITELIST, user1.address)).to.be.true
      expect(await walletListContract.addressList(WHITELIST, user.address)).to.equal(member.address)
      expect(await walletListContract.addressList(WHITELIST, user1.address)).to.equal(member.address)
    })

    it('Batch remove from list', async function () {
      const { member, user, user1, walletListContract } = await loadFixture(deploy)
      await walletListContract.connect(member).batchAddToList(WHITELIST, MEMBER, [user.address, user1.address])
      await walletListContract.connect(member).batchRemoveFromList(WHITELIST, MEMBER, [user.address, user1.address])
      expect(await walletListContract.isAddressInList(WHITELIST, user.address)).to.be.false
      expect(await walletListContract.isAddressInList(WHITELIST, user1.address)).to.be.false
      expect(await walletListContract.addressList(WHITELIST, user.address)).to.equal(ethers.ZeroAddress)
      expect(await walletListContract.addressList(WHITELIST, user1.address)).to.equal(ethers.ZeroAddress)
    })
  })

  describe('Member List', function () {
    it('Admin can add/remove to/from a list', async function () {
      const { user, walletListContract } = await loadFixture(deploy)
      await walletListContract.addToList(MEMBER, DEFAULT_ADMIN_ROLE, user.address)
      expect(await walletListContract.isAddressInList(MEMBER, user.address)).to.be.true
      await walletListContract.removeFromList(MEMBER, DEFAULT_ADMIN_ROLE, user.address)
      expect(await walletListContract.isAddressInList(MEMBER, user.address)).to.be.false
    })

    it('Cannot add to status list if already in list', async function () {
      const { user, walletListContract } = await loadFixture(deploy)
      await walletListContract.addToList(MEMBER, DEFAULT_ADMIN_ROLE, user.address)
      await expect(walletListContract.addToList(MEMBER, DEFAULT_ADMIN_ROLE, user.address)).to.be.revertedWithCustomError(walletListContract, 'AlreadyListed')
    })

    it("Cannot remove from status list if haven't in list yet", async function () {
      const { user, walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.removeFromList(MEMBER, DEFAULT_ADMIN_ROLE, user.address)).to.be.revertedWithCustomError(walletListContract, 'NotListed')
    })

    it('Cannot add zero address to list', async function () {
      const { member, walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.connect(member).addToList(WHITELIST, MEMBER, ethers.ZeroAddress)).to.be.revertedWith('Invalid address')
    })
  })
})
describe('WalletList Admin Functions', function () {
  async function deploy() {
    const [admin, member, anotherMember, user, user1] = await ethers.getSigners()
    const walletListFactory = await ethers.getContractFactory('WalletList')
    const walletListContract = await walletListFactory.deploy()
    await walletListContract.addToList(MEMBER, DEFAULT_ADMIN_ROLE, member.address)
    await walletListContract.addToList(MEMBER, DEFAULT_ADMIN_ROLE, anotherMember.address)
    return { admin, member, anotherMember, user, user1, walletListContract }
  }

  describe('isAdmin', function () {
    it('Deployer is admin', async function () {
      const { admin, walletListContract } = await loadFixture(deploy)
      expect(await walletListContract.isAdmin(admin.address)).to.be.true
    })

    it('Non-admin returns false', async function () {
      const { user, walletListContract } = await loadFixture(deploy)
      expect(await walletListContract.isAdmin(user.address)).to.be.false
    })

    it('Member is not admin', async function () {
      const { member, walletListContract } = await loadFixture(deploy)
      expect(await walletListContract.isAdmin(member.address)).to.be.false
    })
  })

  describe('setRoleManageList', function () {
    it('Admin can set role manage list', async function () {
      const { walletListContract } = await loadFixture(deploy)
      await walletListContract.setRoleManageList(BLACKLIST, DEFAULT_ADMIN_ROLE, true)
      expect(await walletListContract.roleManageList(BLACKLIST, DEFAULT_ADMIN_ROLE)).to.be.true
    })

    it('Admin can disable role manage list', async function () {
      const { walletListContract } = await loadFixture(deploy)
      await walletListContract.setRoleManageList(BLACKLIST, DEFAULT_ADMIN_ROLE, true)
      await walletListContract.setRoleManageList(BLACKLIST, DEFAULT_ADMIN_ROLE, false)
      expect(await walletListContract.roleManageList(BLACKLIST, DEFAULT_ADMIN_ROLE)).to.be.false
    })

    it('Reverts with NoChange when setting same value', async function () {
      const { walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.setRoleManageList(WHITELIST, MEMBER, true)).to.be.revertedWithCustomError(walletListContract, 'NoChange')
    })

    it('Emits ListPermissionChanged event', async function () {
      const { walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.setRoleManageList(BLACKLIST, DEFAULT_ADMIN_ROLE, true))
        .to.emit(walletListContract, 'ListPermissionChanged')
        .withArgs(BLACKLIST, DEFAULT_ADMIN_ROLE, true)
    })
  })

  describe('Admin manages admin list', function () {
    it('Admin can add another admin', async function () {
      const { admin, user, walletListContract } = await loadFixture(deploy)
      await walletListContract.addAdmin(user.address)
      expect(await walletListContract.isAdmin(user.address)).to.be.true
    })

    it('Admin can remove another admin', async function () {
      const { admin, user, walletListContract } = await loadFixture(deploy)
      await walletListContract.addAdmin(user.address)
      await walletListContract.removeAdmin(user.address)
      expect(await walletListContract.isAdmin(user.address)).to.be.false
    })

    it('Non-admin cannot add admin', async function () {
      const { member, user, walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.connect(member).addAdmin(user.address)).to.be.revertedWithCustomError(walletListContract, 'OwnableUnauthorizedAccount')
    })
  })

  describe('Member remove from list', function () {
    it('Member can remove user they added', async function () {
      const { member, user, walletListContract } = await loadFixture(deploy)
      await walletListContract.connect(member).addToList(WHITELIST, MEMBER, user.address)
      await walletListContract.connect(member).removeFromList(WHITELIST, MEMBER, user.address)
      expect(await walletListContract.isAddressInList(WHITELIST, user.address)).to.be.false
    })
  })

  describe('Admin force-remove bypasses ownership', function () {
    it('Admin can force-remove user added by revoked member', async function () {
      const { admin, member, user, walletListContract } = await loadFixture(deploy)
      // Member adds user to whitelist
      await walletListContract.connect(member).addToList(WHITELIST, MEMBER, user.address)
      expect(await walletListContract.isAddressInList(WHITELIST, user.address)).to.be.true
      // Admin removes member
      await walletListContract.removeFromList(MEMBER, DEFAULT_ADMIN_ROLE, member.address)
      // Admin can still force-remove user (resolves manager-revoked deadlock)
      await walletListContract.batchRemoveFromListByAdmin(WHITELIST, MEMBER, [user.address], member.address)
      expect(await walletListContract.isAddressInList(WHITELIST, user.address)).to.be.false
    })
  })
})

describe('WalletList Branch Coverage', function () {
  async function deploy() {
    const [admin, member, anotherMember, user, user1] = await ethers.getSigners()
    const walletListFactory = await ethers.getContractFactory('WalletList')
    const walletListContract = await walletListFactory.deploy()
    await walletListContract.addToList(MEMBER, DEFAULT_ADMIN_ROLE, member.address)
    await walletListContract.addToList(MEMBER, DEFAULT_ADMIN_ROLE, anotherMember.address)
    return { admin, member, anotherMember, user, user1, walletListContract }
  }

  describe('Admin list guard: DEFAULT_ADMIN_ROLE restricted', function () {
    it('batchAddToListByAdmin reverts for DEFAULT_ADMIN_ROLE list', async function () {
      const { admin, user, walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.batchAddToListByAdmin(DEFAULT_ADMIN_ROLE, MEMBER, [user.address], admin.address)).to.be.revertedWith('Use addAdmin for admin list')
    })

    it('batchRemoveFromListByAdmin reverts for DEFAULT_ADMIN_ROLE list', async function () {
      const { admin, user, walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.batchRemoveFromListByAdmin(DEFAULT_ADMIN_ROLE, MEMBER, [user.address], admin.address)).to.be.revertedWith('Use removeAdmin for admin list')
    })

    it('setRoleManageList reverts for DEFAULT_ADMIN_ROLE list', async function () {
      const { walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.setRoleManageList(DEFAULT_ADMIN_ROLE, MEMBER, true)).to.be.revertedWith('Admin list managed by owner only')
    })
  })

  describe('addAdmin edge cases', function () {
    it('Reverts when adding zero address', async function () {
      const { walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.addAdmin(ZERO_ADDRESS)).to.be.revertedWith('Invalid address')
    })

    it('Reverts when adding existing admin', async function () {
      const { user, walletListContract } = await loadFixture(deploy)
      await walletListContract.addAdmin(user.address)
      await expect(walletListContract.addAdmin(user.address)).to.be.revertedWithCustomError(walletListContract, 'AlreadyListed')
    })
  })

  describe('removeAdmin edge cases', function () {
    it('Non-owner cannot remove admin', async function () {
      const { member, user, walletListContract } = await loadFixture(deploy)
      await walletListContract.addAdmin(user.address)
      await expect(walletListContract.connect(member).removeAdmin(user.address)).to.be.revertedWithCustomError(walletListContract, 'OwnableUnauthorizedAccount')
    })

    it('Reverts when removing non-admin', async function () {
      const { user, walletListContract } = await loadFixture(deploy)
      await expect(walletListContract.removeAdmin(user.address)).to.be.revertedWithCustomError(walletListContract, 'NotListed')
    })
  })
})
