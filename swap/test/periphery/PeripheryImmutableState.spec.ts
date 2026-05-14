import { expect } from 'chai'
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { v3RouterFixture } from '../shared/externalFixtures'

describe('PeripheryImmutableState', () => {
  async function nonfungiblePositionManagerFixture() {
    const signers = await ethers.getSigners()
    const { weth9, factory } = await v3RouterFixture(signers)

    const stateFactory = await ethers.getContractFactory('PeripheryImmutableStateTest')
    const state = await stateFactory.deploy(factory.target, weth9.target)

    return {
      weth9,
      factory,
      state,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let factory: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let weth9: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: any

  beforeEach('load fixture', async () => {
    ;({ state, weth9, factory } = await loadFixture(nonfungiblePositionManagerFixture))
  })

  it('bytecode size', async () => {
    expect(((await ethers.provider.getCode(state.target)).length - 2) / 2).to.matchSnapshot()
  })

  describe('#WETH9', () => {
    it('points to WETH9', async () => {
      expect(await state.WETH9()).to.eq(weth9.target)
    })
  })

  describe('#factory', () => {
    it('points to v3 core factory', async () => {
      expect(await state.factory()).to.eq(factory.target)
    })
  })
})
