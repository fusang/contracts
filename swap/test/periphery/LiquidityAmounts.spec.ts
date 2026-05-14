import { expect } from 'chai'
import { ethers } from 'hardhat'
import { encodePriceSqrt } from '../shared/encodePriceSqrt'

describe('LiquidityAmounts', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let liquidityFromAmounts: any

  before('deploy test library', async () => {
    const liquidityFromAmountsTestFactory = await ethers.getContractFactory('LiquidityAmountsTest')
    liquidityFromAmounts = await liquidityFromAmountsTestFactory.deploy()
  })

  describe('#getLiquidityForAmounts', () => {
    it('amounts for price inside', async () => {
      const sqrtPriceX96 = encodePriceSqrt(1, 1)
      const sqrtPriceAX96 = encodePriceSqrt(100, 110)
      const sqrtPriceBX96 = encodePriceSqrt(110, 100)
      const liquidity = await liquidityFromAmounts.getLiquidityForAmounts(
        sqrtPriceX96,
        sqrtPriceAX96,
        sqrtPriceBX96,
        100,
        200
      )
      expect(liquidity).to.eq(2148)
    })

    it('amounts for price below', async () => {
      const sqrtPriceX96 = encodePriceSqrt(99, 110)
      const sqrtPriceAX96 = encodePriceSqrt(100, 110)
      const sqrtPriceBX96 = encodePriceSqrt(110, 100)
      const liquidity = await liquidityFromAmounts.getLiquidityForAmounts(
        sqrtPriceX96,
        sqrtPriceAX96,
        sqrtPriceBX96,
        100,
        200
      )
      expect(liquidity).to.eq(1048)
    })

    it('amounts for price above', async () => {
      const sqrtPriceX96 = encodePriceSqrt(111, 100)
      const sqrtPriceAX96 = encodePriceSqrt(100, 110)
      const sqrtPriceBX96 = encodePriceSqrt(110, 100)
      const liquidity = await liquidityFromAmounts.getLiquidityForAmounts(
        sqrtPriceX96,
        sqrtPriceAX96,
        sqrtPriceBX96,
        100,
        200
      )
      expect(liquidity).to.eq(2097)
    })

    it('amounts for price equal to lower boundary', async () => {
      const sqrtPriceAX96 = encodePriceSqrt(100, 110)
      const sqrtPriceX96 = sqrtPriceAX96
      const sqrtPriceBX96 = encodePriceSqrt(110, 100)
      const liquidity = await liquidityFromAmounts.getLiquidityForAmounts(
        sqrtPriceX96,
        sqrtPriceAX96,
        sqrtPriceBX96,
        100,
        200
      )
      expect(liquidity).to.eq(1048)
    })

    it('amounts for price equal to upper boundary', async () => {
      const sqrtPriceAX96 = encodePriceSqrt(100, 110)
      const sqrtPriceBX96 = encodePriceSqrt(110, 100)
      const sqrtPriceX96 = sqrtPriceBX96
      const liquidity = await liquidityFromAmounts.getLiquidityForAmounts(
        sqrtPriceX96,
        sqrtPriceAX96,
        sqrtPriceBX96,
        100,
        200
      )
      expect(liquidity).to.eq(2097)
    })
  })

  describe('#getAmountsForLiquidity', () => {
    it('amounts for price inside', async () => {
      const sqrtPriceX96 = encodePriceSqrt(1, 1)
      const sqrtPriceAX96 = encodePriceSqrt(100, 110)
      const sqrtPriceBX96 = encodePriceSqrt(110, 100)
      const { amount0, amount1 } = await liquidityFromAmounts.getAmountsForLiquidity(
        sqrtPriceX96,
        sqrtPriceAX96,
        sqrtPriceBX96,
        2148
      )
      expect(amount0).to.eq(99)
      expect(amount1).to.eq(99)
    })

    it('amounts for price below', async () => {
      const sqrtPriceX96 = encodePriceSqrt(99, 110)
      const sqrtPriceAX96 = encodePriceSqrt(100, 110)
      const sqrtPriceBX96 = encodePriceSqrt(110, 100)
      const { amount0, amount1 } = await liquidityFromAmounts.getAmountsForLiquidity(
        sqrtPriceX96,
        sqrtPriceAX96,
        sqrtPriceBX96,
        1048
      )
      expect(amount0).to.eq(99)
      expect(amount1).to.eq(0)
    })

    it('amounts for price above', async () => {
      const sqrtPriceX96 = encodePriceSqrt(111, 100)
      const sqrtPriceAX96 = encodePriceSqrt(100, 110)
      const sqrtPriceBX96 = encodePriceSqrt(110, 100)
      const { amount0, amount1 } = await liquidityFromAmounts.getAmountsForLiquidity(
        sqrtPriceX96,
        sqrtPriceAX96,
        sqrtPriceBX96,
        2097
      )
      expect(amount0).to.eq(0)
      expect(amount1).to.eq(199)
    })

    it('amounts for price on lower boundary', async () => {
      const sqrtPriceAX96 = encodePriceSqrt(100, 110)
      const sqrtPriceX96 = sqrtPriceAX96
      const sqrtPriceBX96 = encodePriceSqrt(110, 100)
      const { amount0, amount1 } = await liquidityFromAmounts.getAmountsForLiquidity(
        sqrtPriceX96,
        sqrtPriceAX96,
        sqrtPriceBX96,
        1048
      )
      expect(amount0).to.eq(99)
      expect(amount1).to.eq(0)
    })

    it('amounts for price on upper boundary', async () => {
      const sqrtPriceAX96 = encodePriceSqrt(100, 110)
      const sqrtPriceBX96 = encodePriceSqrt(110, 100)
      const sqrtPriceX96 = sqrtPriceBX96
      const { amount0, amount1 } = await liquidityFromAmounts.getAmountsForLiquidity(
        sqrtPriceX96,
        sqrtPriceAX96,
        sqrtPriceBX96,
        2097
      )
      expect(amount0).to.eq(0)
      expect(amount1).to.eq(199)
    })
  })
})
