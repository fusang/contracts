import { expect } from 'chai'
import { ethers } from 'hardhat'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { getPermitSignature } from '../shared/permit'

describe('SelfPermit', () => {
  let wallet: HardhatEthersSigner
  let other: HardhatEthersSigner

  async function selfPermitFixture() {
    const tokenFactory = await ethers.getContractFactory('TestERC20PermitAllowed')
    const token = await tokenFactory.deploy(0)

    const selfPermitTestFactory = await ethers.getContractFactory('SelfPermitTest')
    const selfPermitTest = await selfPermitTestFactory.deploy()

    return {
      token,
      selfPermitTest,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let token: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let selfPermitTest: any

  before('create fixture loader', async () => {
    const wallets = await ethers.getSigners()
    ;[wallet, other] = wallets
  })

  beforeEach('load fixture', async () => {
    ;({ token, selfPermitTest } = await loadFixture(selfPermitFixture))
  })

  it('#permit', async () => {
    const value = 123

    const { v, r, s } = await getPermitSignature(wallet, token, other.address, value)

    expect(await token.allowance(wallet.address, other.address)).to.be.eq(0)
    await token['permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'](
      wallet.address,
      other.address,
      value,
      ethers.MaxUint256,
      v,
      r,
      s
    )
    expect(await token.allowance(wallet.address, other.address)).to.be.eq(value)
  })

  describe('#selfPermit', () => {
    const value = 456

    it('works', async () => {
      const { v, r, s } = await getPermitSignature(wallet, token, selfPermitTest.target, value)

      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(0)
      await selfPermitTest.selfPermit(token.target, value, ethers.MaxUint256, v, r, s)
      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(value)
    })

    it('fails if permit is submitted externally', async () => {
      const { v, r, s } = await getPermitSignature(wallet, token, selfPermitTest.target, value)

      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(0)
      await token['permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'](
        wallet.address,
        selfPermitTest.target,
        value,
        ethers.MaxUint256,
        v,
        r,
        s
      )
      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(value)

      await expect(selfPermitTest.selfPermit(token.target, value, ethers.MaxUint256, v, r, s)).to.be.revertedWith(
        'ERC20Permit: invalid signature'
      )
    })
  })

  describe('#selfPermitIfNecessary', () => {
    const value = 789

    it('works', async () => {
      const { v, r, s } = await getPermitSignature(wallet, token, selfPermitTest.target, value)

      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(0)
      await selfPermitTest.selfPermitIfNecessary(token.target, value, ethers.MaxUint256, v, r, s)
      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(value)
    })

    it('does not fail if permit is submitted externally', async () => {
      const { v, r, s } = await getPermitSignature(wallet, token, selfPermitTest.target, value)

      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(0)
      await token['permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'](
        wallet.address,
        selfPermitTest.target,
        value,
        ethers.MaxUint256,
        v,
        r,
        s
      )
      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(value)

      await selfPermitTest.selfPermitIfNecessary(token.target, value, ethers.MaxUint256, v, r, s)
    })
  })

  describe('#selfPermitAllowed', () => {
    it('works', async () => {
      const { v, r, s } = await getPermitSignature(wallet, token, selfPermitTest.target, ethers.MaxUint256)

      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(0)
      await expect(selfPermitTest.selfPermitAllowed(token.target, 0, ethers.MaxUint256, v, r, s))
        .to.emit(token, 'Approval')
        .withArgs(wallet.address, selfPermitTest.target, ethers.MaxUint256)
      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(ethers.MaxUint256)
    })

    it('fails if permit is submitted externally', async () => {
      const { v, r, s } = await getPermitSignature(wallet, token, selfPermitTest.target, ethers.MaxUint256)

      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(0)
      await token['permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)'](
        wallet.address,
        selfPermitTest.target,
        0,
        ethers.MaxUint256,
        true,
        v,
        r,
        s
      )
      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(ethers.MaxUint256)

      await expect(
        selfPermitTest.selfPermitAllowed(token.target, 0, ethers.MaxUint256, v, r, s)
      ).to.be.revertedWith('TestERC20PermitAllowed::permit: wrong nonce')
    })
  })

  describe('#selfPermitAllowedIfNecessary', () => {
    it('works', async () => {
      const { v, r, s } = await getPermitSignature(wallet, token, selfPermitTest.target, ethers.MaxUint256)

      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.eq(0)
      await expect(selfPermitTest.selfPermitAllowedIfNecessary(token.target, 0, ethers.MaxUint256, v, r, s))
        .to.emit(token, 'Approval')
        .withArgs(wallet.address, selfPermitTest.target, ethers.MaxUint256)
      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.eq(ethers.MaxUint256)
    })

    it('skips if already max approved', async () => {
      const { v, r, s } = await getPermitSignature(wallet, token, selfPermitTest.target, ethers.MaxUint256)

      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(0)
      await token.approve(selfPermitTest.target, ethers.MaxUint256)
      await expect(
        selfPermitTest.selfPermitAllowedIfNecessary(token.target, 0, ethers.MaxUint256, v, r, s)
      ).to.not.emit(token, 'Approval')
      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.eq(ethers.MaxUint256)
    })

    it('does not fail if permit is submitted externally', async () => {
      const { v, r, s } = await getPermitSignature(wallet, token, selfPermitTest.target, ethers.MaxUint256)

      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(0)
      await token['permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)'](
        wallet.address,
        selfPermitTest.target,
        0,
        ethers.MaxUint256,
        true,
        v,
        r,
        s
      )
      expect(await token.allowance(wallet.address, selfPermitTest.target)).to.be.eq(ethers.MaxUint256)

      await selfPermitTest.selfPermitAllowedIfNecessary(token.target, 0, ethers.MaxUint256, v, r, s)
    })
  })
})
