import { expect } from 'chai'
import { ethers } from 'hardhat'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import completeFixture from '../shared/completeFixture'
import { FeeAmount } from '../shared/constants'

describe('CallbackValidation', () => {
  let nonpairAddr: HardhatEthersSigner
  let wallets: HardhatEthersSigner[]

  async function callbackValidationFixture() {
    const signers = await ethers.getSigners()
    const { factory } = await completeFixture(signers)
    const tokenFactory = await ethers.getContractFactory('contracts/periphery/test/TestERC20.sol:TestERC20')
    const callbackValidationFactory = await ethers.getContractFactory('TestCallbackValidation')
    const tokens = [
      await tokenFactory.deploy(ethers.MaxUint256 / 2n),
      await tokenFactory.deploy(ethers.MaxUint256 / 2n),
    ]
    const callbackValidation = await callbackValidationFactory.deploy()

    return {
      tokens,
      callbackValidation,
      factory,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let callbackValidation: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tokens: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let factory: any

  before('get signers', async () => {
    ;[nonpairAddr, ...wallets] = await ethers.getSigners()
  })

  beforeEach('load fixture', async () => {
    ;({ callbackValidation, tokens, factory } = await loadFixture(callbackValidationFixture))
  })

  it('reverts when called from an address other than the associated UniswapV3Pool', async () => {
    expect(
      callbackValidation
        .connect(nonpairAddr)
        .verifyCallback(factory.target, tokens[0].target, tokens[1].target, FeeAmount.MEDIUM)
    ).to.be.reverted
  })
})
