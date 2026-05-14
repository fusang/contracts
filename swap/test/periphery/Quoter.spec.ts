/* eslint-disable @typescript-eslint/no-explicit-any */
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import completeFixture from '../shared/completeFixture'
import { FeeAmount, MaxUint128, TICK_SPACINGS } from '../shared/constants'
import { encodePriceSqrt } from '../shared/encodePriceSqrt'
import { expandTo18Decimals } from '../shared/expandTo18Decimals'
import { expect } from '../shared/expect'
import { encodePath } from '../shared/path'
import { createPool } from '../shared/quoter'

describe('Quoter', () => {
  let wallet: HardhatEthersSigner
  let trader: HardhatEthersSigner

  let nft: any
  let tokens: [any, any, any]
  let quoter: any
  let factory: any

  const swapRouterFixture = async () => {
    const { weth9, factory, router, tokens, nft, allowList } = await completeFixture()

    // approve & fund wallets
    for (const token of tokens) {
      await token.approve(router.target, ethers.MaxUint256)
      await token.approve(nft.target, ethers.MaxUint256)
      await token.connect(trader).approve(router.target, ethers.MaxUint256)
      await token.transfer(trader.address, expandTo18Decimals(1_000_000))
    }

    const quoterFactory = await ethers.getContractFactory('Quoter')
    const quoter = await quoterFactory.deploy(factory.target, weth9.target)

    // Add quoter to allowList so it can simulate swaps
    await allowList.setAllowed(quoter.target, true)

    return {
      tokens,
      nft,
      quoter,
      factory,
    }
  }

  before('create fixture loader', async () => {
    const wallets = await ethers.getSigners()
    ;[wallet, trader] = wallets
  })

  // helper for getting weth and token balances
  beforeEach('load fixture', async () => {
    ;({ tokens, nft, quoter, factory } = await loadFixture(swapRouterFixture))
  })

  describe('quotes', () => {
    beforeEach(async () => {
      await createPool(nft, wallet, tokens[0].target, tokens[1].target, factory)
      await createPool(nft, wallet, tokens[1].target, tokens[2].target, factory)
    })

    describe('#quoteExactInput', () => {
      it('0 -> 1', async () => {
        const quote = await quoter.quoteExactInput.staticCall(
          encodePath([tokens[0].target, tokens[1].target], [FeeAmount.MEDIUM]),
          3
        )

        expect(quote).to.eq(1)
      })

      it('1 -> 0', async () => {
        const quote = await quoter.quoteExactInput.staticCall(
          encodePath([tokens[1].target, tokens[0].target], [FeeAmount.MEDIUM]),
          3
        )

        expect(quote).to.eq(1)
      })

      it('0 -> 1 -> 2', async () => {
        const quote = await quoter.quoteExactInput.staticCall(
          encodePath(
            tokens.map((token) => token.target),
            [FeeAmount.MEDIUM, FeeAmount.MEDIUM]
          ),
          5
        )

        expect(quote).to.eq(1)
      })

      it('2 -> 1 -> 0', async () => {
        const quote = await quoter.quoteExactInput.staticCall(
          encodePath(tokens.map((token) => token.target).reverse(), [FeeAmount.MEDIUM, FeeAmount.MEDIUM]),
          5
        )

        expect(quote).to.eq(1)
      })
    })

    describe('#quoteExactInputSingle', () => {
      it('0 -> 1', async () => {
        const quote = await quoter.quoteExactInputSingle.staticCall(
          tokens[0].target,
          tokens[1].target,
          FeeAmount.MEDIUM,
          MaxUint128,
          // -2%
          encodePriceSqrt(100, 102)
        )

        expect(quote).to.eq(9852)
      })

      it('1 -> 0', async () => {
        const quote = await quoter.quoteExactInputSingle.staticCall(
          tokens[1].target,
          tokens[0].target,
          FeeAmount.MEDIUM,
          MaxUint128,
          // +2%
          encodePriceSqrt(102, 100)
        )

        expect(quote).to.eq(9852)
      })
    })

    describe('#quoteExactOutput', () => {
      it('0 -> 1', async () => {
        const quote = await quoter.quoteExactOutput.staticCall(
          encodePath([tokens[1].target, tokens[0].target], [FeeAmount.MEDIUM]),
          1
        )

        expect(quote).to.eq(3)
      })

      it('1 -> 0', async () => {
        const quote = await quoter.quoteExactOutput.staticCall(
          encodePath([tokens[0].target, tokens[1].target], [FeeAmount.MEDIUM]),
          1
        )

        expect(quote).to.eq(3)
      })

      it('0 -> 1 -> 2', async () => {
        const quote = await quoter.quoteExactOutput.staticCall(
          encodePath(tokens.map((token) => token.target).reverse(), [FeeAmount.MEDIUM, FeeAmount.MEDIUM]),
          1
        )

        expect(quote).to.eq(5)
      })

      it('2 -> 1 -> 0', async () => {
        const quote = await quoter.quoteExactOutput.staticCall(
          encodePath(
            tokens.map((token) => token.target),
            [FeeAmount.MEDIUM, FeeAmount.MEDIUM]
          ),
          1
        )

        expect(quote).to.eq(5)
      })
    })

    describe('#quoteExactOutputSingle', () => {
      it('0 -> 1', async () => {
        const quote = await quoter.quoteExactOutputSingle.staticCall(
          tokens[0].target,
          tokens[1].target,
          FeeAmount.MEDIUM,
          MaxUint128,
          encodePriceSqrt(100, 102)
        )

        expect(quote).to.eq(9981)
      })

      it('1 -> 0', async () => {
        const quote = await quoter.quoteExactOutputSingle.staticCall(
          tokens[1].target,
          tokens[0].target,
          FeeAmount.MEDIUM,
          MaxUint128,
          encodePriceSqrt(102, 100)
        )

        expect(quote).to.eq(9981)
      })
    })
  })
})
