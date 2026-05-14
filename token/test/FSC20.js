const { expect } = require('chai')
const { ethers } = require('hardhat')
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers')
const { abi: wallletListAbi, bytecode: walletListBytecode } = require('../artifacts/contracts/walletList/WalletList.sol/WalletList.json')

const name = 'FusangTest'
const symbol = 'FSCT'
const FROZENLIST = ethers.keccak256(ethers.toUtf8Bytes('FROZENLIST'))
const MEMBER = ethers.keccak256(ethers.toUtf8Bytes('MEMBER'))
const WHITELIST = ethers.keccak256(ethers.toUtf8Bytes('WHITELIST'))
const BLACKLIST = ethers.keccak256(ethers.toUtf8Bytes('BLACKLIST'))
const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'

describe('FSC20', function () {
  async function deploy() {
    const [admin, member, whitelistedUser1, whitelistedUser2, notWhitelistedUser] = await ethers.getSigners()
    const walletListFactory = await ethers.getContractFactory(wallletListAbi, walletListBytecode, admin)
    const walletListContract = await walletListFactory.deploy()
    // Deploy FSC20
    const fsc20Factory = await ethers.getContractFactory('FSC20')
    const fsc20Contract = await fsc20Factory.deploy(name, symbol, walletListContract.target)
    // Check remdeem status
    expect(await fsc20Contract.paused()).to.equal(false)
    // Whitelist
    await walletListContract.setRoleManageList(BLACKLIST, DEFAULT_ADMIN_ROLE, true)
    await walletListContract.setRoleManageList(FROZENLIST, DEFAULT_ADMIN_ROLE, true)
    await walletListContract.addToList(MEMBER, DEFAULT_ADMIN_ROLE, member.address)
    await walletListContract.connect(member).addToList(WHITELIST, MEMBER, whitelistedUser1.address)
    await walletListContract.connect(member).addToList(WHITELIST, MEMBER, whitelistedUser2.address)
    return { admin, member, whitelistedUser1, whitelistedUser2, notWhitelistedUser, walletListContract, fsc20Contract }
  }

  it('Mint', async function () {
    const { admin, whitelistedUser1, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    expect(await fsc20Contract.balanceOf(whitelistedUser1.address)).to.equal(mintAmount)
  })

  it('Batch Mint', async function () {
    const { admin, whitelistedUser1, whitelistedUser2, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).batchMint([whitelistedUser1.address, whitelistedUser2.address], [mintAmount, mintAmount])
    expect(await fsc20Contract.balanceOf(whitelistedUser1.address)).to.equal(mintAmount)
    expect(await fsc20Contract.balanceOf(whitelistedUser2.address)).to.equal(mintAmount)
  })

  it('Only owner can mint', async function () {
    const { whitelistedUser1, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000
    await expect(fsc20Contract.connect(whitelistedUser1).mint(whitelistedUser1.address, mintAmount)).to.be.revertedWithCustomError(fsc20Contract, 'OwnableUnauthorizedAccount')
  })

  it('Only owner can batch mint', async function () {
    const { whitelistedUser1, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000
    await expect(fsc20Contract.connect(whitelistedUser1).batchMint([whitelistedUser1.address], [mintAmount])).to.be.revertedWithCustomError(
      fsc20Contract,
      'OwnableUnauthorizedAccount',
    )
  })

  it('Transfer', async function () {
    const { admin, whitelistedUser1, whitelistedUser2, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await fsc20Contract.connect(whitelistedUser1).transfer(whitelistedUser2.address, mintAmount)
    expect(await fsc20Contract.balanceOf(whitelistedUser2.address)).to.equal(mintAmount)
  })

  it('Only whitelisted user can receive the tokens', async function () {
    const { admin, whitelistedUser1, notWhitelistedUser, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await expect(fsc20Contract.connect(whitelistedUser1).transfer(notWhitelistedUser.address, mintAmount)).to.be.revertedWithCustomError(fsc20Contract, 'NotWhitelisted')
  })

  it('Only whitelisted user can send the tokens', async function () {
    const { admin, whitelistedUser1, whitelistedUser2, fsc20Contract, walletListContract, member } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await walletListContract.connect(member).removeFromList(WHITELIST, MEMBER, whitelistedUser1.address)
    await expect(fsc20Contract.connect(whitelistedUser1).transfer(whitelistedUser2.address, mintAmount)).to.be.revertedWithCustomError(fsc20Contract, 'NotWhitelisted')
  })

  it('Approve', async function () {
    const { admin, whitelistedUser1, whitelistedUser2, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await fsc20Contract.connect(whitelistedUser1).approve(whitelistedUser2.address, mintAmount)
    expect(await fsc20Contract.allowance(whitelistedUser1.address, whitelistedUser2.address)).to.equal(mintAmount)
  })

  it('Only whitelisted user can be approved', async function () {
    const { admin, whitelistedUser1, notWhitelistedUser, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await expect(fsc20Contract.connect(whitelistedUser1).approve(notWhitelistedUser.address, mintAmount)).to.be.revertedWithCustomError(fsc20Contract, 'NotWhitelisted')
  })

  it('Admin can mint tokens to a blacklisted user if they are still whitelisted', async function () {
    const { admin, whitelistedUser1, fsc20Contract, walletListContract } = await loadFixture(deploy)
    const mintAmount = 10000

    // Add user to blacklist (while still whitelisted)
    await walletListContract.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser1.address)

    // Admin should be able to mint tokens to blacklisted user
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    expect(await fsc20Contract.balanceOf(whitelistedUser1.address)).to.equal(mintAmount)
  })

  it('Admin can mint tokens to a blacklisted user if they are still whitelisted', async function () {
    const { admin, whitelistedUser1, fsc20Contract, walletListContract } = await loadFixture(deploy)
    const mintAmount = 10000

    // Add user to blacklist (while still whitelisted)
    await walletListContract.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser1.address)

    // Admin should be able to mint tokens to blacklisted user
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    expect(await fsc20Contract.balanceOf(whitelistedUser1.address)).to.equal(mintAmount)
  })

  it('Admin can burn tokens from a frozenlisted user if they are still whitelisted', async function () {
    const { admin, whitelistedUser1, member, fsc20Contract, walletListContract } = await loadFixture(deploy)
    const mintAmount = 10000
    const burnAmount = 5000

    // Mint tokens to whitelisted user
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    expect(await fsc20Contract.balanceOf(whitelistedUser1.address)).to.equal(mintAmount)
    // Add user to frozenlist (while still whitelisted)
    await walletListContract.connect(member).addToList(FROZENLIST, MEMBER, whitelistedUser1.address)
    // Admin should be able to burn tokens from frozenlisted user
    await fsc20Contract.connect(admin).batchBurn([whitelistedUser1.address], [burnAmount])
    expect(await fsc20Contract.balanceOf(whitelistedUser1.address)).to.equal(mintAmount - burnAmount)
  })

  it("Admin can't burn token from a blacklist wallet if it is non whitelist address", async function () {
    const { admin, whitelistedUser1, member, fsc20Contract, walletListContract } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await walletListContract.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser1.address)
    await walletListContract.connect(member).removeFromList(WHITELIST, MEMBER, whitelistedUser1.address)
    await expect(fsc20Contract.connect(admin).batchBurn([whitelistedUser1.address], [mintAmount])).to.be.revertedWithCustomError(fsc20Contract, 'NotWhitelisted')
  })

  it("Admin can't mint token to a blacklist wallet if it is non whitelist address", async function () {
    const { admin, whitelistedUser1, member, fsc20Contract, walletListContract } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await walletListContract.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser1.address)
    await walletListContract.connect(member).removeFromList(WHITELIST, MEMBER, whitelistedUser1.address)
    await expect(fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)).to.be.revertedWithCustomError(fsc20Contract, 'NotWhitelisted')
  })

  it('Only whitelisted user can approve', async function () {
    const { admin, whitelistedUser1, whitelistedUser2, fsc20Contract, walletListContract, member } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await walletListContract.connect(member).removeFromList(WHITELIST, MEMBER, whitelistedUser1.address)
    await expect(fsc20Contract.connect(whitelistedUser1).approve(whitelistedUser2.address, mintAmount)).to.be.revertedWithCustomError(fsc20Contract, 'NotWhitelisted')
  })

  it('Burn', async function () {
    const { admin, whitelistedUser1, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await fsc20Contract.connect(whitelistedUser1).burn(mintAmount)
    expect(await fsc20Contract.balanceOf(whitelistedUser1.address)).to.equal(0)
  })

  it('Batch Burn', async function () {
    const { admin, whitelistedUser1, whitelistedUser2, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await fsc20Contract.connect(admin).mint(whitelistedUser2.address, mintAmount)
    await fsc20Contract.connect(admin).batchBurn([whitelistedUser1.address, whitelistedUser2.address], [mintAmount, mintAmount])
    expect(await fsc20Contract.balanceOf(whitelistedUser1.address)).to.equal(0)
    expect(await fsc20Contract.balanceOf(whitelistedUser2.address)).to.equal(0)
  })

  it('Only owner can batch burn', async function () {
    const { whitelistedUser1, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000
    await expect(fsc20Contract.connect(whitelistedUser1).batchBurn([whitelistedUser1.address], [mintAmount])).to.be.revertedWithCustomError(
      fsc20Contract,
      'OwnableUnauthorizedAccount',
    )
  })

  it('Batch length mismatch', async function () {
    const { admin, whitelistedUser1, whitelistedUser2, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 1000
    await expect(fsc20Contract.connect(admin).batchBurn([whitelistedUser1.address, whitelistedUser2.address], [mintAmount])).to.be.revertedWithCustomError(
      fsc20Contract,
      'ArraysLengthMismatch',
    )
    await expect(fsc20Contract.connect(admin).batchMint([whitelistedUser1.address], [])).to.be.revertedWithCustomError(fsc20Contract, 'ArraysLengthMismatch')
  })

  it('All actions are not available after paused', async function () {
    const { fsc20Contract, whitelistedUser1, admin } = await loadFixture(deploy)
    const mintAmount = 1000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await fsc20Contract.connect(admin).pause(true)
    await expect(fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)).to.be.revertedWithCustomError(fsc20Contract, 'AlreadyPaused')
    await expect(fsc20Contract.connect(whitelistedUser1).transfer(admin.address, mintAmount)).to.be.revertedWithCustomError(fsc20Contract, 'AlreadyPaused')
    await expect(fsc20Contract.connect(whitelistedUser1).burn(mintAmount)).to.be.revertedWithCustomError(fsc20Contract, 'AlreadyPaused')
    await expect(fsc20Contract.connect(whitelistedUser1).approve(admin.address, mintAmount)).to.be.revertedWithCustomError(fsc20Contract, 'AlreadyPaused')
  })

  it('Only owner can pause', async function () {
    const { fsc20Contract, whitelistedUser1 } = await loadFixture(deploy)
    await expect(fsc20Contract.connect(whitelistedUser1).pause(true)).to.be.revertedWithCustomError(fsc20Contract, 'OwnableUnauthorizedAccount')
  })

  it('Owner can not pause twice', async function () {
    const { fsc20Contract, admin } = await loadFixture(deploy)
    await fsc20Contract.connect(admin).pause(true)
    await expect(fsc20Contract.connect(admin).pause(true)).to.be.revertedWithCustomError(fsc20Contract, 'AlreadyPaused')
  })

  it('Freeze/BurnFrozen/Unfreeze', async function () {
    const { admin, member, whitelistedUser1, fsc20Contract, walletListContract } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await walletListContract.connect(member).addToList(WHITELIST, MEMBER, fsc20Contract.target)
    await fsc20Contract.connect(admin).batchFreeze([whitelistedUser1.address], [10])
    expect(await fsc20Contract.balanceOf(whitelistedUser1.address)).to.equal(9990)
    expect(await fsc20Contract.frozenBalance(whitelistedUser1.address)).to.equal(10)
    await fsc20Contract.connect(admin).batchUnFreeze([whitelistedUser1.address], [5])
    expect(await fsc20Contract.balanceOf(whitelistedUser1.address)).to.equal(9995)
    expect(await fsc20Contract.frozenBalance(whitelistedUser1.address)).to.equal(5)
    await fsc20Contract.connect(admin).batchBurnFrozen([whitelistedUser1.address], [5])
    expect(await fsc20Contract.balanceOf(whitelistedUser1.address)).to.equal(9995)
    expect(await fsc20Contract.frozenBalance(whitelistedUser1.address)).to.equal(0)
  })

  it('Batch length mismatch', async function () {
    const { admin, member, whitelistedUser1, whitelistedUser2, fsc20Contract, walletListContract } = await loadFixture(deploy)
    const mintAmount = 10000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await walletListContract.connect(member).addToList(WHITELIST, MEMBER, fsc20Contract.target)
    await expect(fsc20Contract.connect(admin).batchFreeze([whitelistedUser1.address, whitelistedUser2.address], [mintAmount])).to.be.revertedWithCustomError(
      fsc20Contract,
      'ArraysLengthMismatch',
    )
    await fsc20Contract.connect(admin).batchFreeze([whitelistedUser1.address], [10])
    await expect(fsc20Contract.connect(admin).batchUnFreeze([whitelistedUser1.address], [])).to.be.revertedWithCustomError(fsc20Contract, 'ArraysLengthMismatch')
    await expect(fsc20Contract.connect(admin).batchBurnFrozen([whitelistedUser1.address], [])).to.be.revertedWithCustomError(fsc20Contract, 'ArraysLengthMismatch')
    await expect(fsc20Contract.connect(admin).batchBurnFrozen([whitelistedUser1.address], [20])).to.be.revertedWithCustomError(fsc20Contract, 'InsufficientFrozenBalance')
  })

  it('Only owner can freeze', async function () {
    const { whitelistedUser1, fsc20Contract } = await loadFixture(deploy)
    await expect(fsc20Contract.connect(whitelistedUser1).batchFreeze([whitelistedUser1.address], [10])).to.be.revertedWithCustomError(fsc20Contract, 'MemberNotRegistered')
    await expect(fsc20Contract.connect(whitelistedUser1).batchUnFreeze([whitelistedUser1.address], [10])).to.be.revertedWithCustomError(fsc20Contract, 'MemberNotRegistered')
  })

  it('Only owner can freeze', async function () {
    const { whitelistedUser1, admin, fsc20Contract } = await loadFixture(deploy)
    await expect(fsc20Contract.connect(admin).batchUnFreeze([whitelistedUser1.address], [10])).to.be.revertedWithCustomError(fsc20Contract, 'InsufficientFrozenBalance')
  })

  it('Only owner can burn freeze', async function () {
    const { whitelistedUser1, fsc20Contract } = await loadFixture(deploy)
    await expect(fsc20Contract.connect(whitelistedUser1).batchBurnFrozen([whitelistedUser1.address], [10])).to.be.revertedWithCustomError(
      fsc20Contract,
      'OwnableUnauthorizedAccount',
    )
  })

  it('Only owner can add document URL', async function () {
    const { fsc20Contract, admin, whitelistedUser1 } = await loadFixture(deploy)
    const url = 'https://example.com/document1'

    await expect(fsc20Contract.connect(whitelistedUser1).addDocumentUrl(url)).to.be.revertedWithCustomError(fsc20Contract, 'OwnableUnauthorizedAccount')
    await fsc20Contract.connect(admin).addDocumentUrl(url)

    const ipfsCids = await fsc20Contract.getIpfsCids()
    expect(ipfsCids).to.include(url)
  })

  it('Only owner can remove document URL', async function () {
    const { fsc20Contract, admin, whitelistedUser1 } = await loadFixture(deploy)
    const url1 = 'https://example.com/document1'
    const url2 = 'https://example.com/document2'

    await fsc20Contract.connect(admin).addDocumentUrl(url1)
    await fsc20Contract.connect(admin).addDocumentUrl(url2)

    await expect(fsc20Contract.connect(whitelistedUser1).removeDocumentUrl(0)).to.be.revertedWithCustomError(fsc20Contract, 'OwnableUnauthorizedAccount')
    await fsc20Contract.connect(admin).removeDocumentUrl(0)

    const ipfsCids = await fsc20Contract.getIpfsCids()
    expect(ipfsCids).to.not.include(url1)
    expect(ipfsCids).to.include(url2)
  })

  it('Should revert when removing document URL with invalid index', async function () {
    const { fsc20Contract, admin } = await loadFixture(deploy)
    const url = 'https://example.com/document1'
    await fsc20Contract.connect(admin).addDocumentUrl(url)
    await expect(fsc20Contract.connect(admin).removeDocumentUrl(1)).to.be.revertedWithCustomError(fsc20Contract, 'IndexOutOfBounds')
  })

  it('Should handle frozen balance transfers correctly', async function () {
    const { admin, whitelistedUser1, walletListContract, member, whitelistedUser2, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 1000
    await walletListContract.connect(member).addToList(WHITELIST, MEMBER, fsc20Contract.target)
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await fsc20Contract.connect(admin).batchFreeze([whitelistedUser1.address], [500])
    // Should not be able to transfer more than unfrozen balance
    await expect(fsc20Contract.connect(whitelistedUser1).transfer(whitelistedUser2.address, 600)).to.be.reverted
  })

  it('Should handle blacklist and frozenlist interaction correctly', async function () {
    const { admin, whitelistedUser1, member, walletListContract, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 1000
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    // Add to both lists
    await walletListContract.addToList(FROZENLIST, DEFAULT_ADMIN_ROLE, whitelistedUser1.address)
    await walletListContract.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser1.address)
    expect(await fsc20Contract.canTransfer(whitelistedUser1.address)).to.be.false
  })

  it('User in frozenlist, whitelist, and blacklist cannot burn their own tokens', async function () {
    const { admin, whitelistedUser1, walletListContract, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000
    const burnAmount = 5000

    // Mint tokens to whitelisted user
    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    expect(await fsc20Contract.balanceOf(whitelistedUser1.address)).to.equal(mintAmount)

    // Add user to frozenlist and blacklist (while still whitelisted)
    await walletListContract.addToList(FROZENLIST, DEFAULT_ADMIN_ROLE, whitelistedUser1.address)
    await walletListContract.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser1.address)

    // User should NOT be able to burn their own tokens
    await expect(fsc20Contract.connect(whitelistedUser1).burn(burnAmount)).to.be.revertedWithCustomError(fsc20Contract, 'NotWhitelisted')
  })

  it('Should revert when minting to zero address', async function () {
    const { admin, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 1000

    await expect(fsc20Contract.connect(admin).mint(ethers.ZeroAddress, mintAmount)).to.be.revertedWithCustomError(fsc20Contract, 'ERC20InvalidReceiver')
  })

  it('Should revert when batch minting to zero address', async function () {
    const { admin, whitelistedUser1, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 1000

    await expect(fsc20Contract.connect(admin).batchMint([whitelistedUser1.address, ethers.ZeroAddress], [mintAmount, mintAmount])).to.be.revertedWithCustomError(
      fsc20Contract,
      'ERC20InvalidReceiver',
    )
  })

  it('Blacklisted spender cannot use transferFrom', async function () {
    const { admin, whitelistedUser1, whitelistedUser2, fsc20Contract, walletListContract } = await loadFixture(deploy)
    const mintAmount = 10000

    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await fsc20Contract.connect(whitelistedUser1).approve(whitelistedUser2.address, mintAmount)
    await walletListContract.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser2.address)

    await expect(fsc20Contract.connect(whitelistedUser2).transferFrom(whitelistedUser1.address, whitelistedUser1.address, 100)).to.be.revertedWithCustomError(
      fsc20Contract,
      'NotWhitelisted',
    )
  })

  it('Should revert when adding duplicate document URL', async function () {
    const { fsc20Contract, admin } = await loadFixture(deploy)
    const url = 'https://example.com/document1'

    await fsc20Contract.connect(admin).addDocumentUrl(url)
    await expect(fsc20Contract.connect(admin).addDocumentUrl(url)).to.be.revertedWithCustomError(fsc20Contract, 'DuplicateUrl')
  })

  it('Can revoke allowance of blacklisted spender', async function () {
    const { admin, whitelistedUser1, whitelistedUser2, fsc20Contract, walletListContract } = await loadFixture(deploy)
    const mintAmount = 10000

    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await fsc20Contract.connect(whitelistedUser1).approve(whitelistedUser2.address, mintAmount)
    await walletListContract.addToList(BLACKLIST, DEFAULT_ADMIN_ROLE, whitelistedUser2.address)

    await fsc20Contract.connect(whitelistedUser1).approve(whitelistedUser2.address, 0)
    expect(await fsc20Contract.allowance(whitelistedUser1.address, whitelistedUser2.address)).to.equal(0)
  })

  it('Can revoke allowance while paused', async function () {
    const { admin, whitelistedUser1, whitelistedUser2, fsc20Contract } = await loadFixture(deploy)
    const mintAmount = 10000

    await fsc20Contract.connect(admin).mint(whitelistedUser1.address, mintAmount)
    await fsc20Contract.connect(whitelistedUser1).approve(whitelistedUser2.address, mintAmount)
    await fsc20Contract.connect(admin).pause(true)

    await fsc20Contract.connect(whitelistedUser1).approve(whitelistedUser2.address, 0)
    expect(await fsc20Contract.allowance(whitelistedUser1.address, whitelistedUser2.address)).to.equal(0)
  })

  it('Emits DocumentUrlRemoved event when removing URL', async function () {
    const { fsc20Contract, admin } = await loadFixture(deploy)
    const url = 'https://example.com/document1'

    await fsc20Contract.connect(admin).addDocumentUrl(url)
    await expect(fsc20Contract.connect(admin).removeDocumentUrl(0)).to.emit(fsc20Contract, 'DocumentUrlRemoved').withArgs(url)
  })

  describe('Constructor validation', function () {
    it('Reverts when WalletList address is zero', async function () {
      const fsc20Factory = await ethers.getContractFactory('FSC20')
      await expect(fsc20Factory.deploy(name, symbol, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(fsc20Factory, 'InvalidWalletList')
        .withArgs(ethers.ZeroAddress)
    })

    it('Reverts when WalletList address has no contract code (EOA)', async function () {
      const [eoa] = await ethers.getSigners()
      const fsc20Factory = await ethers.getContractFactory('FSC20')
      await expect(fsc20Factory.deploy(name, symbol, eoa.address))
        .to.be.revertedWithCustomError(fsc20Factory, 'InvalidWalletList')
        .withArgs(eoa.address)
    })
  })
})
