/* eslint-disable @typescript-eslint/no-explicit-any */
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import completeFixture from '../shared/completeFixture'
import { FeeAmount, MaxUint128 } from '../shared/constants'
import { encodePriceSqrt } from '../shared/encodePriceSqrt'
import { expandTo18Decimals } from '../shared/expandTo18Decimals'
import { expect } from '../shared/expect'
import { encodePath } from '../shared/path'
import { createPool, createPoolWithMultiplePositions, createPoolWithZeroTickInitialized } from '../shared/quoter'

describe('QuoterV2', function () {
  this.timeout(40000)
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

    const quoterFactory = await ethers.getContractFactory('QuoterV2')
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
      await createPoolWithMultiplePositions(nft, wallet, tokens[0].target, tokens[2].target, factory)
    })

    describe('#quoteExactInput', () => {
      it('0 -> 2 cross 2 tick', async () => {
        const { amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactInput.staticCall(
            encodePath([tokens[0].target, tokens[2].target], [FeeAmount.MEDIUM]),
            10000
          )

        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('78461846509168490764501028180')
        expect(initializedTicksCrossedList[0]).to.eq(2)
        expect(amountOut).to.eq(9871)
      })

      it('0 -> 2 cross 2 tick where after is initialized', async () => {
        // The swap amount is set such that the active tick after the swap is -120.
        // -120 is an initialized tick for this pool. We check that we don't count it.
        const { amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactInput.staticCall(
            encodePath([tokens[0].target, tokens[2].target], [FeeAmount.MEDIUM]),
            6200
          )

        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('78757224507315167622282810783')
        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(initializedTicksCrossedList[0]).to.eq(1)
        expect(amountOut).to.eq(6143)
      })

      it('0 -> 2 cross 1 tick', async () => {
        const { amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactInput.staticCall(
            encodePath([tokens[0].target, tokens[2].target], [FeeAmount.MEDIUM]),
            4000
          )

        expect(initializedTicksCrossedList[0]).to.eq(1)
        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('78926452400586371254602774705')
        expect(amountOut).to.eq(3971)
      })

      it('0 -> 2 cross 0 tick, starting tick not initialized', async () => {
        // Tick before 0, tick after -1.
        const { amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactInput.staticCall(
            encodePath([tokens[0].target, tokens[2].target], [FeeAmount.MEDIUM]),
            10
          )

        expect(initializedTicksCrossedList[0]).to.eq(0)
        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('79227483487511329217250071027')
        expect(amountOut).to.eq(8)
      })

      it('0 -> 2 cross 0 tick, starting tick initialized', async () => {
        // Tick before 0, tick after -1. Tick 0 initialized.
        await createPoolWithZeroTickInitialized(nft, wallet, tokens[0].target, tokens[2].target, factory)

        const { amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactInput.staticCall(
            encodePath([tokens[0].target, tokens[2].target], [FeeAmount.MEDIUM]),
            10
          )

        expect(initializedTicksCrossedList[0]).to.eq(1)
        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('79227817515327498931091950511')
        expect(amountOut).to.eq(8)
      })

      it('2 -> 0 cross 2', async () => {
        const { amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactInput.staticCall(
            encodePath([tokens[2].target, tokens[0].target], [FeeAmount.MEDIUM]),
            10000
          )

        expect(initializedTicksCrossedList[0]).to.eq(2)
        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('80001962924147897865541384515')
        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(amountOut).to.eq(9871)
      })

      it('2 -> 0 cross 2 where tick after is initialized', async () => {
        // The swap amount is set such that the active tick after the swap is 120.
        // 120 is an initialized tick for this pool. We check we don't count it.
        const { amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactInput.staticCall(
            encodePath([tokens[2].target, tokens[0].target], [FeeAmount.MEDIUM]),
            6250
          )

        expect(initializedTicksCrossedList[0]).to.eq(2)
        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('79705728824507063507279123685')
        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(amountOut).to.eq(6190)
      })

      it('2 -> 0 cross 0 tick, starting tick initialized', async () => {
        // Tick 0 initialized. Tick after = 1
        await createPoolWithZeroTickInitialized(nft, wallet, tokens[0].target, tokens[2].target, factory)

        const { amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactInput.staticCall(
            encodePath([tokens[2].target, tokens[0].target], [FeeAmount.MEDIUM]),
            200
          )

        expect(initializedTicksCrossedList[0]).to.eq(0)
        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('79235729830182478001034429156')
        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(amountOut).to.eq(198)
      })

      it('2 -> 0 cross 0 tick, starting tick not initialized', async () => {
        // Tick 0 initialized. Tick after = 1
        const { amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactInput.staticCall(
            encodePath([tokens[2].target, tokens[0].target], [FeeAmount.MEDIUM]),
            103
          )

        expect(initializedTicksCrossedList[0]).to.eq(0)
        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('79235858216754624215638319723')
        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(amountOut).to.eq(101)
      })

      it('2 -> 1', async () => {
        const { amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactInput.staticCall(
            encodePath([tokens[2].target, tokens[1].target], [FeeAmount.MEDIUM]),
            10000
          )

        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('80018067294531553039351583520')
        expect(initializedTicksCrossedList[0]).to.eq(0)
        expect(amountOut).to.eq(9871)
      })

      it('0 -> 2 -> 1', async () => {
        const { amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactInput.staticCall(
            encodePath([tokens[0].target, tokens[2].target, tokens[1].target], [FeeAmount.MEDIUM, FeeAmount.MEDIUM]),
            10000
          )

        expect(sqrtPriceX96AfterList.length).to.eq(2)
        expect(sqrtPriceX96AfterList[0]).to.eq('78461846509168490764501028180')
        expect(sqrtPriceX96AfterList[1]).to.eq('80007846861567212939802016351')
        expect(initializedTicksCrossedList[0]).to.eq(2)
        expect(initializedTicksCrossedList[1]).to.eq(0)
        expect(amountOut).to.eq(9745)
      })
    })

    describe('#quoteExactInputSingle', () => {
      it('0 -> 2', async () => {
        const {
          amountOut: quote,
          sqrtPriceX96After,
          initializedTicksCrossed,
          gasEstimate,
        } = await quoter.quoteExactInputSingle.staticCall({
          tokenIn: tokens[0].target,
          tokenOut: tokens[2].target,
          fee: FeeAmount.MEDIUM,
          amountIn: 10000,
          // -2%
          sqrtPriceLimitX96: encodePriceSqrt(100, 102),
        })

        expect(initializedTicksCrossed).to.eq(2)
        expect(quote).to.eq(9871)
        expect(sqrtPriceX96After).to.eq('78461846509168490764501028180')
      })

      it('2 -> 0', async () => {
        const {
          amountOut: quote,
          sqrtPriceX96After,
          initializedTicksCrossed,
          gasEstimate,
        } = await quoter.quoteExactInputSingle.staticCall({
          tokenIn: tokens[2].target,
          tokenOut: tokens[0].target,
          fee: FeeAmount.MEDIUM,
          amountIn: 10000,
          // +2%
          sqrtPriceLimitX96: encodePriceSqrt(102, 100),
        })

        expect(initializedTicksCrossed).to.eq(2)
        expect(quote).to.eq(9871)
        expect(sqrtPriceX96After).to.eq('80001962924147897865541384515')
      })
    })

    describe('#quoteExactOutput', () => {
      it('0 -> 2 cross 2 tick', async () => {
        const { amountIn, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactOutput.staticCall(
            encodePath([tokens[2].target, tokens[0].target], [FeeAmount.MEDIUM]),
            15000
          )

        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(initializedTicksCrossedList[0]).to.eq(2)
        expect(amountIn).to.eq(15273)

        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('78055527257643669242286029831')
      })

      it('0 -> 2 cross 2 where tick after is initialized', async () => {
        // The swap amount is set such that the active tick after the swap is -120.
        // -120 is an initialized tick for this pool. We check that we count it.
        const { amountIn, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactOutput.staticCall(
            encodePath([tokens[2].target, tokens[0].target], [FeeAmount.MEDIUM]),
            6143
          )

        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('78757225449310403327341205211')
        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(initializedTicksCrossedList[0]).to.eq(1)
        expect(amountIn).to.eq(6200)
      })

      it('0 -> 2 cross 1 tick', async () => {
        const { amountIn, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactOutput.staticCall(
            encodePath([tokens[2].target, tokens[0].target], [FeeAmount.MEDIUM]),
            4000
          )

        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(initializedTicksCrossedList[0]).to.eq(1)
        expect(amountIn).to.eq(4029)

        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('78924219757724709840818372098')
      })

      it('0 -> 2 cross 0 tick starting tick initialized', async () => {
        // Tick before 0, tick after 1. Tick 0 initialized.
        await createPoolWithZeroTickInitialized(nft, wallet, tokens[0].target, tokens[2].target, factory)
        const { amountIn, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactOutput.staticCall(
            encodePath([tokens[2].target, tokens[0].target], [FeeAmount.MEDIUM]),
            100
          )

        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(initializedTicksCrossedList[0]).to.eq(1)
        expect(amountIn).to.eq(102)

        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('79224329176051641448521403903')
      })

      it('0 -> 2 cross 0 tick starting tick not initialized', async () => {
        const { amountIn, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactOutput.staticCall(
            encodePath([tokens[2].target, tokens[0].target], [FeeAmount.MEDIUM]),
            10
          )

        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(initializedTicksCrossedList[0]).to.eq(0)
        expect(amountIn).to.eq(12)

        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('79227408033628034983534698435')
      })

      it('2 -> 0 cross 2 ticks', async () => {
        const { amountIn, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactOutput.staticCall(
            encodePath([tokens[0].target, tokens[2].target], [FeeAmount.MEDIUM]),
            15000
          )

        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(initializedTicksCrossedList[0]).to.eq(2)
        expect(amountIn).to.eq(15273)
        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('80418414376567919517220409857')
      })

      it('2 -> 0 cross 2 where tick after is initialized', async () => {
        // The swap amount is set such that the active tick after the swap is 120.
        // 120 is an initialized tick for this pool. We check that we don't count it.
        const { amountIn, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactOutput.staticCall(
            encodePath([tokens[0].target, tokens[2].target], [FeeAmount.MEDIUM]),
            6223
          )

        expect(initializedTicksCrossedList[0]).to.eq(2)
        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('79708304437530892332449657932')
        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(amountIn).to.eq(6283)
      })

      it('2 -> 0 cross 1 tick', async () => {
        const { amountIn, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactOutput.staticCall(
            encodePath([tokens[0].target, tokens[2].target], [FeeAmount.MEDIUM]),
            6000
          )

        expect(initializedTicksCrossedList[0]).to.eq(1)
        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('79690640184021170956740081887')
        expect(initializedTicksCrossedList.length).to.eq(1)
        expect(amountIn).to.eq(6055)
      })

      it('2 -> 1', async () => {
        const { amountIn, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactOutput.staticCall(
            encodePath([tokens[1].target, tokens[2].target], [FeeAmount.MEDIUM]),
            9871
          )

        expect(sqrtPriceX96AfterList.length).to.eq(1)
        expect(sqrtPriceX96AfterList[0]).to.eq('80018020393569259756601362385')
        expect(initializedTicksCrossedList[0]).to.eq(0)
        expect(amountIn).to.eq(10000)
      })

      it('0 -> 2 -> 1', async () => {
        const { amountIn, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate } =
          await quoter.quoteExactOutput.staticCall(
            encodePath([tokens[0].target, tokens[2].target, tokens[1].target].reverse(), [
              FeeAmount.MEDIUM,
              FeeAmount.MEDIUM,
            ]),
            9745
          )

        expect(sqrtPriceX96AfterList.length).to.eq(2)
        expect(sqrtPriceX96AfterList[0]).to.eq('80007838904387594703933785072')
        expect(sqrtPriceX96AfterList[1]).to.eq('78461888503179331029803316753')
        expect(initializedTicksCrossedList[0]).to.eq(0)
        expect(initializedTicksCrossedList[1]).to.eq(2)
        expect(amountIn).to.eq(10000)
      })
    })

    describe('#quoteExactOutputSingle', () => {
      it('0 -> 1', async () => {
        const { amountIn, sqrtPriceX96After, initializedTicksCrossed, gasEstimate } =
          await quoter.quoteExactOutputSingle.staticCall({
            tokenIn: tokens[0].target,
            tokenOut: tokens[1].target,
            fee: FeeAmount.MEDIUM,
            amount: MaxUint128,
            sqrtPriceLimitX96: encodePriceSqrt(100, 102),
          })

        expect(amountIn).to.eq(9981)
        expect(initializedTicksCrossed).to.eq(0)
        expect(sqrtPriceX96After).to.eq('78447570448055484695608110440')
      })

      it('1 -> 0', async () => {
        const { amountIn, sqrtPriceX96After, initializedTicksCrossed, gasEstimate } =
          await quoter.quoteExactOutputSingle.staticCall({
            tokenIn: tokens[1].target,
            tokenOut: tokens[0].target,
            fee: FeeAmount.MEDIUM,
            amount: MaxUint128,
            sqrtPriceLimitX96: encodePriceSqrt(102, 100),
          })

        expect(amountIn).to.eq(9981)
        expect(initializedTicksCrossed).to.eq(0)
        expect(sqrtPriceX96After).to.eq('80016521857016594389520272648')
      })
    })
  })
})
