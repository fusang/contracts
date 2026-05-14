const { expect } = require('chai')
const { ethers } = require('hardhat')
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers')
const { abi: wallletListAbi, bytecode: walletListBytecode } = require('../artifacts/contracts/walletList/WalletList.sol/WalletList.json')
const { abi: fsc20ContractABI, deployedBytecode: fsc20ContractBytecode } = require('../artifacts/contracts/fsc20/FSC20.sol/FSC20.json')

const name = 'FusangTest'
const symbol = 'FSCT'

const FROZENLIST = ethers.keccak256(ethers.toUtf8Bytes('FROZENLIST'))
const MEMBER = ethers.keccak256(ethers.toUtf8Bytes('MEMBER'))
const WHITELIST = ethers.keccak256(ethers.toUtf8Bytes('WHITELIST'))
const BLACKLIST = ethers.keccak256(ethers.toUtf8Bytes('BLACKLIST'))
const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'

describe('FSC20Factory', function () {
  async function deploy() {
    const [admin, member, whitelistedUser1] = await ethers.getSigners()

    const walletListFactory = await ethers.getContractFactory(wallletListAbi, walletListBytecode, admin)
    const walletListContract = await walletListFactory.deploy()
    // Deploy FSC20
    const factory = await ethers.getContractFactory('FSC20Factory')
    const factoryContract = await factory.deploy(walletListContract.target)
    // Whitelist
    await walletListContract.addToList(MEMBER, DEFAULT_ADMIN_ROLE, member.address)
    return { admin, member, whitelistedUser1, walletListContract, factoryContract }
  }

  it('Deployed', async function () {
    const { factoryContract, walletListContract } = await loadFixture(deploy)
    expect(await factoryContract.walletListContract()).to.equal(walletListContract.target)
  })

  it('Deploy new FSC20', async function () {
    const { factoryContract, admin } = await loadFixture(deploy)
    const deployTx = await factoryContract.deploy(name, symbol)
    const result = await deployTx.wait()
    const event = result.logs.find((log) => {
      try {
        return factoryContract.interface.parseLog(log)?.name === 'FSC20TokenCreated'
      } catch {
        return false
      }
    })
    const fsc20Address = factoryContract.interface.parseLog(event).args[0]
    let fsc20Contract = new ethers.Contract(fsc20Address, fsc20ContractABI, admin)

    // With Ownable2Step, transferOwnership sets pendingOwner
    expect(await fsc20Contract.pendingOwner()).to.equal(admin.address)
    // Admin accepts ownership
    await fsc20Contract.connect(admin).acceptOwnership()
    expect(await fsc20Contract.owner()).to.equal(admin.address)
    expect(await fsc20Contract.name()).to.equal(name)
    expect(await fsc20Contract.symbol()).to.equal(symbol)
  })

  it('Only owner can deploy new FSC20', async function () {
    const { factoryContract, whitelistedUser1 } = await loadFixture(deploy)
    await expect(factoryContract.connect(whitelistedUser1).deploy(name, symbol)).to.be.revertedWithCustomError(factoryContract, 'OwnableUnauthorizedAccount')
  })

  describe('Constructor validation', function () {
    it('Reverts when WalletList address is zero', async function () {
      const factory = await ethers.getContractFactory('FSC20Factory')
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, 'InvalidWalletList').withArgs(ethers.ZeroAddress)
    })

    it('Reverts when WalletList address has no contract code (EOA)', async function () {
      const [eoa] = await ethers.getSigners()
      const factory = await ethers.getContractFactory('FSC20Factory')
      await expect(factory.deploy(eoa.address)).to.be.revertedWithCustomError(factory, 'InvalidWalletList').withArgs(eoa.address)
    })
  })
})
