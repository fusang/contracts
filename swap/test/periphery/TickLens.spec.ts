import { expect } from 'chai'
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import completeFixture from '../shared/completeFixture'
import { FeeAmount, TICK_SPACINGS } from '../shared/constants'
import { encodePriceSqrt } from '../shared/encodePriceSqrt'
import { getMaxTick, getMinTick } from '../shared/ticks'
import { computePoolAddress } from '../shared/computePoolAddress'

describe('TickLens', () => {
  let wallets: any[]

  async function nftFixture() {
    const signers = await ethers.getSigners()
    const { factory, tokens, nft } = await completeFixture(signers)

    for (const token of tokens) {
      await token.approve(nft.target, ethers.MaxUint256)
    }

    return {
      factory,
      nft,
      tokens,
    }
  }

  let factory: any
  let nft: any
  let tokens: any[]
  let poolAddress: string
  let tickLens: any

  before('create fixture loader', async () => {
    wallets = await ethers.getSigners()
  })

  beforeEach('load fixture', async () => {
    ;({ factory, tokens, nft } = await loadFixture(nftFixture))
  })

  describe('#getPopulatedTicksInWord', () => {
    const fullRangeLiquidity = 1000000
    async function createPool(tokenAddressA: string, tokenAddressB: string) {
      if (tokenAddressA.toLowerCase() > tokenAddressB.toLowerCase())
        [tokenAddressA, tokenAddressB] = [tokenAddressB, tokenAddressA]

      await factory.createPool(tokenAddressA, tokenAddressB, FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        tokenAddressA,
        tokenAddressB,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const liquidityParams = {
        token0: tokenAddressA,
        token1: tokenAddressB,
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: wallets[0].address,
        amount0Desired: 1000000,
        amount1Desired: 1000000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }

      return nft.mint(liquidityParams)
    }

    async function mint(tickLower: number, tickUpper: number, amountBothDesired: bigint | number): Promise<number> {
      const mintParams = {
        token0: tokens[0].target,
        token1: tokens[1].target,
        fee: FeeAmount.MEDIUM,
        tickLower,
        tickUpper,
        amount0Desired: amountBothDesired,
        amount1Desired: amountBothDesired,
        amount0Min: 0,
        amount1Min: 0,
        recipient: wallets[0].address,
        deadline: 1,
      }

      const liquidity = await nft.mint.staticCall(mintParams)

      await nft.mint(mintParams)
      return Number(liquidity.liquidity)
    }

    beforeEach(async () => {
      await createPool(tokens[0].target, tokens[1].target)
      poolAddress = computePoolAddress(factory.target, [tokens[0].target, tokens[1].target], FeeAmount.MEDIUM)
    })

    beforeEach(async () => {
      const lensFactory = await ethers.getContractFactory('TickLensTest')
      tickLens = await lensFactory.deploy()
    })

    function getTickBitmapIndex(tick: bigint | number, tickSpacing: number): bigint {
      const intermediate = BigInt(tick) / BigInt(tickSpacing)
      // see https://docs.soliditylang.org/en/v0.7.6/types.html#shifts
      return intermediate < 0n ? (intermediate + 1n) / (2n ** 8n) - 1n : intermediate >> 8n
    }

    it('works for min/max', async () => {
      const [min] = await tickLens.getPopulatedTicksInWord(
        poolAddress,
        getTickBitmapIndex(getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]), TICK_SPACINGS[FeeAmount.MEDIUM])
      )

      const [max] = await tickLens.getPopulatedTicksInWord(
        poolAddress,
        getTickBitmapIndex(getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]), TICK_SPACINGS[FeeAmount.MEDIUM])
      )

      expect(min.tick).to.be.eq(getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]))
      expect(min.liquidityNet).to.be.eq(fullRangeLiquidity)
      expect(min.liquidityGross).to.be.eq(fullRangeLiquidity)

      expect(max.tick).to.be.eq(getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]))
      expect(max.liquidityNet).to.be.eq(fullRangeLiquidity * -1)
      expect(min.liquidityGross).to.be.eq(fullRangeLiquidity)
    })

    it('works for min/max and -2/-1/0/1', async () => {
      const minus = -TICK_SPACINGS[FeeAmount.MEDIUM]
      const plus = -minus

      const liquidity0 = await mint(minus * 2, minus, 2)
      const liquidity1 = await mint(minus * 2, 0, 3)
      const liquidity2 = await mint(minus * 2, plus, 5)
      const liquidity3 = await mint(minus, 0, 7)
      const liquidity4 = await mint(minus, plus, 11)
      const liquidity5 = await mint(0, plus, 13)

      const [min] = await tickLens.getPopulatedTicksInWord(
        poolAddress,
        getTickBitmapIndex(getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]), TICK_SPACINGS[FeeAmount.MEDIUM])
      )

      const [negativeOne, negativeTwo] = await tickLens.getPopulatedTicksInWord(
        poolAddress,
        getTickBitmapIndex(minus, TICK_SPACINGS[FeeAmount.MEDIUM])
      )

      const [one, zero] = await tickLens.getPopulatedTicksInWord(
        poolAddress,
        getTickBitmapIndex(plus, TICK_SPACINGS[FeeAmount.MEDIUM])
      )

      const [max] = await tickLens.getPopulatedTicksInWord(
        poolAddress,
        getTickBitmapIndex(getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]), TICK_SPACINGS[FeeAmount.MEDIUM])
      )

      expect(min.tick).to.be.eq(getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]))
      expect(min.liquidityNet).to.be.eq(fullRangeLiquidity)
      expect(min.liquidityGross).to.be.eq(fullRangeLiquidity)

      expect(negativeTwo.tick).to.be.eq(minus * 2)
      expect(negativeTwo.liquidityNet).to.be.eq(liquidity0 + liquidity1 + liquidity2)
      expect(negativeTwo.liquidityGross).to.be.eq(liquidity0 + liquidity1 + liquidity2)

      expect(negativeOne.tick).to.be.eq(minus)
      expect(negativeOne.liquidityNet).to.be.eq(liquidity3 + liquidity4 - liquidity0)
      expect(negativeOne.liquidityGross).to.be.eq(liquidity3 + liquidity4 + liquidity0)

      expect(zero.tick).to.be.eq(0)
      expect(zero.liquidityNet).to.be.eq(liquidity5 - liquidity1 - liquidity3)
      expect(zero.liquidityGross).to.be.eq(liquidity5 + liquidity1 + liquidity3)

      expect(one.tick).to.be.eq(plus)
      expect(one.liquidityNet).to.be.eq(-liquidity2 - liquidity4 - liquidity5)
      expect(one.liquidityGross).to.be.eq(liquidity2 + liquidity4 + liquidity5)

      expect(max.tick).to.be.eq(getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]))
      expect(max.liquidityNet).to.be.eq(fullRangeLiquidity * -1)
      expect(max.liquidityGross).to.be.eq(fullRangeLiquidity)
    })

    it('fully populated ticks', async () => {
      // fully populate a word
      for (let i = 0; i < 128; i++) {
        await mint(i * TICK_SPACINGS[FeeAmount.MEDIUM], (255 - i) * TICK_SPACINGS[FeeAmount.MEDIUM], 100)
      }

      const ticks = await tickLens.getPopulatedTicksInWord(
        poolAddress,
        getTickBitmapIndex(0, TICK_SPACINGS[FeeAmount.MEDIUM])
      )
      expect(ticks.length).to.be.eq(256)
    }).timeout(300_000)
  })
})
