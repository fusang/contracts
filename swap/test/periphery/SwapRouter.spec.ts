/* eslint-disable @typescript-eslint/no-explicit-any */
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import completeFixture from '../shared/completeFixture'
import { FeeAmount, TICK_SPACINGS } from '../shared/constants'
import { encodePriceSqrt } from '../shared/encodePriceSqrt'
import { expandTo18Decimals } from '../shared/expandTo18Decimals'
import { expect } from '../shared/expect'
import { encodePath } from '../shared/path'
import { getMaxTick, getMinTick } from '../shared/ticks'
import { computePoolAddress } from '../shared/computePoolAddress'

describe('SwapRouter', function () {
  this.timeout(40000)
  let wallet: HardhatEthersSigner
  let trader: HardhatEthersSigner

  let factory: any
  let weth9: any
  let router: any
  let nft: any
  let tokens: [any, any, any]
  let getBalances: (who: string) => Promise<{
    weth9: bigint
    token0: bigint
    token1: bigint
    token2: bigint
  }>

  const swapRouterFixture = async () => {
    const { weth9, factory, router, tokens, nft } = await completeFixture()

    // approve & fund wallets
    for (const token of tokens) {
      await token.approve(router.target, ethers.MaxUint256)
      await token.approve(nft.target, ethers.MaxUint256)
      await token.connect(trader).approve(router.target, ethers.MaxUint256)
      await token.transfer(trader.address, expandTo18Decimals(1_000_000))
    }

    return {
      weth9,
      factory,
      router,
      tokens,
      nft,
    }
  }

  before('create fixture loader', async () => {
    ;[wallet, trader] = await ethers.getSigners()
  })

  // helper for getting weth and token balances
  beforeEach('load fixture', async () => {
    ;({ router, weth9, factory, tokens, nft } = await loadFixture(swapRouterFixture))

    getBalances = async (who: string) => {
      const balances = await Promise.all([
        weth9.balanceOf(who),
        tokens[0].balanceOf(who),
        tokens[1].balanceOf(who),
        tokens[2].balanceOf(who),
      ])
      return {
        weth9: balances[0],
        token0: balances[1],
        token1: balances[2],
        token2: balances[3],
      }
    }
  })

  // ensure the swap router never ends up with a balance
  afterEach('load fixture', async () => {
    const balances = await getBalances(router.target)
    expect(Object.values(balances).every((b) => b === 0n)).to.be.eq(true)
    const balance = await ethers.provider.getBalance(router.target)
    expect(balance === 0n).to.be.eq(true)
  })

  describe('swaps', () => {
    const liquidity = 1000000
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
        recipient: wallet.address,
        amount0Desired: 1000000,
        amount1Desired: 1000000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      }

      return nft.mint(liquidityParams)
    }

    async function createPoolWETH9(tokenAddress: string) {
      await weth9.deposit({ value: liquidity })
      await weth9.approve(nft.target, ethers.MaxUint256)
      return createPool(weth9.target, tokenAddress)
    }

    beforeEach('create 0-1 and 1-2 pools', async () => {
      await createPool(tokens[0].target, tokens[1].target)
      await createPool(tokens[1].target, tokens[2].target)
    })

    describe('#exactInput', () => {
      async function exactInput(
        tokenAddresses: string[],
        amountIn: number = 3,
        amountOutMinimum: number = 1
      ): Promise<any> {
        const inputIsWETH = weth9.target === tokenAddresses[0]
        const outputIsWETH9 = tokenAddresses[tokenAddresses.length - 1] === weth9.target

        const value = inputIsWETH ? amountIn : 0

        const params = {
          path: encodePath(tokenAddresses, new Array(tokenAddresses.length - 1).fill(FeeAmount.MEDIUM)),
          recipient: outputIsWETH9 ? ethers.ZeroAddress : trader.address,
          deadline: 1,
          amountIn,
          amountOutMinimum,
        }

        const data = [router.interface.encodeFunctionData('exactInput', [params])]
        if (outputIsWETH9)
          data.push(router.interface.encodeFunctionData('unwrapWETH9', [amountOutMinimum, trader.address]))

        // ensure that the swap fails if the limit is any tighter
        params.amountOutMinimum += 1
        await expect(router.connect(trader).exactInput(params, { value })).to.be.revertedWith('Too little received')
        params.amountOutMinimum -= 1

        // optimized for the gas test
        return data.length === 1
          ? router.connect(trader).exactInput(params, { value })
          : router.connect(trader).multicall(data, { value })
      }

      describe('single-pool', () => {
        it('0 -> 1', async () => {
          const pool = await factory.getPool(tokens[0].target, tokens[1].target, FeeAmount.MEDIUM)

          // get balances before
          const poolBefore = await getBalances(pool)
          const traderBefore = await getBalances(trader.address)

          await exactInput(tokens.slice(0, 2).map((token) => token.target))

          // get balances after
          const poolAfter = await getBalances(pool)
          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token0).to.be.eq(traderBefore.token0 - 3n)
          expect(traderAfter.token1).to.be.eq(traderBefore.token1 + 1n)
          expect(poolAfter.token0).to.be.eq(poolBefore.token0 + 3n)
          expect(poolAfter.token1).to.be.eq(poolBefore.token1 - 1n)
        })

        it('1 -> 0', async () => {
          const pool = await factory.getPool(tokens[1].target, tokens[0].target, FeeAmount.MEDIUM)

          // get balances before
          const poolBefore = await getBalances(pool)
          const traderBefore = await getBalances(trader.address)

          await exactInput(
            tokens
              .slice(0, 2)
              .reverse()
              .map((token) => token.target)
          )

          // get balances after
          const poolAfter = await getBalances(pool)
          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token0).to.be.eq(traderBefore.token0 + 1n)
          expect(traderAfter.token1).to.be.eq(traderBefore.token1 - 3n)
          expect(poolAfter.token0).to.be.eq(poolBefore.token0 - 1n)
          expect(poolAfter.token1).to.be.eq(poolBefore.token1 + 3n)
        })
      })

      describe('multi-pool', () => {
        it('0 -> 1 -> 2', async () => {
          const traderBefore = await getBalances(trader.address)

          await exactInput(
            tokens.map((token) => token.target),
            5,
            1
          )

          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token0).to.be.eq(traderBefore.token0 - 5n)
          expect(traderAfter.token2).to.be.eq(traderBefore.token2 + 1n)
        })

        it('2 -> 1 -> 0', async () => {
          const traderBefore = await getBalances(trader.address)

          await exactInput(tokens.map((token) => token.target).reverse(), 5, 1)

          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token2).to.be.eq(traderBefore.token2 - 5n)
          expect(traderAfter.token0).to.be.eq(traderBefore.token0 + 1n)
        })

        it('events', async () => {
          await expect(
            exactInput(
              tokens.map((token) => token.target),
              5,
              1
            )
          )
            .to.emit(tokens[0], 'Transfer')
            .withArgs(
              trader.address,
              computePoolAddress(factory.target, [tokens[0].target, tokens[1].target], FeeAmount.MEDIUM),
              5
            )
            .to.emit(tokens[1], 'Transfer')
            .withArgs(
              computePoolAddress(factory.target, [tokens[0].target, tokens[1].target], FeeAmount.MEDIUM),
              router.target,
              3
            )
            .to.emit(tokens[1], 'Transfer')
            .withArgs(
              router.target,
              computePoolAddress(factory.target, [tokens[1].target, tokens[2].target], FeeAmount.MEDIUM),
              3
            )
            .to.emit(tokens[2], 'Transfer')
            .withArgs(
              computePoolAddress(factory.target, [tokens[1].target, tokens[2].target], FeeAmount.MEDIUM),
              trader.address,
              1
            )
        })
      })

      describe('ETH input', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].target)
          })

          it('WETH9 -> 0', async () => {
            const pool = await factory.getPool(weth9.target, tokens[0].target, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactInput([weth9.target, tokens[0].target]))
              .to.emit(weth9, 'Deposit')
              .withArgs(router.target, 3)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0 + 1n)
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9 + 3n)
            expect(poolAfter.token0).to.be.eq(poolBefore.token0 - 1n)
          })

          it('WETH9 -> 0 -> 1', async () => {
            const traderBefore = await getBalances(trader.address)

            await expect(exactInput([weth9.target, tokens[0].target, tokens[1].target], 5))
              .to.emit(weth9, 'Deposit')
              .withArgs(router.target, 5)

            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token1).to.be.eq(traderBefore.token1 + 1n)
          })
        })
      })

      describe('ETH output', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].target)
            await createPoolWETH9(tokens[1].target)
          })

          it('0 -> WETH9', async () => {
            const pool = await factory.getPool(tokens[0].target, weth9.target, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactInput([tokens[0].target, weth9.target]))
              .to.emit(weth9, 'Withdrawal')
              .withArgs(router.target, 1)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0 - 3n)
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9 - 1n)
            expect(poolAfter.token0).to.be.eq(poolBefore.token0 + 3n)
          })

          it('0 -> 1 -> WETH9', async () => {
            // get balances before
            const traderBefore = await getBalances(trader.address)

            await expect(exactInput([tokens[0].target, tokens[1].target, weth9.target], 5))
              .to.emit(weth9, 'Withdrawal')
              .withArgs(router.target, 1)

            // get balances after
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0 - 5n)
          })
        })
      })
    })

    describe('#exactInputSingle', () => {
      async function exactInputSingle(
        tokenIn: string,
        tokenOut: string,
        amountIn: number = 3,
        amountOutMinimum: number = 1,
        sqrtPriceLimitX96?: bigint
      ): Promise<any> {
        const inputIsWETH = weth9.target === tokenIn
        const outputIsWETH9 = tokenOut === weth9.target

        const value = inputIsWETH ? amountIn : 0

        const params = {
          tokenIn,
          tokenOut,
          fee: FeeAmount.MEDIUM,
          sqrtPriceLimitX96:
            sqrtPriceLimitX96 ?? tokenIn.toLowerCase() < tokenOut.toLowerCase()
              ? 4295128740n
              : 1461446703485210103287273052203988822378723970341n,
          recipient: outputIsWETH9 ? ethers.ZeroAddress : trader.address,
          deadline: 1,
          amountIn,
          amountOutMinimum,
        }

        const data = [router.interface.encodeFunctionData('exactInputSingle', [params])]
        if (outputIsWETH9)
          data.push(router.interface.encodeFunctionData('unwrapWETH9', [amountOutMinimum, trader.address]))

        // ensure that the swap fails if the limit is any tighter
        params.amountOutMinimum += 1
        await expect(router.connect(trader).exactInputSingle(params, { value })).to.be.revertedWith(
          'Too little received'
        )
        params.amountOutMinimum -= 1

        // optimized for the gas test
        return data.length === 1
          ? router.connect(trader).exactInputSingle(params, { value })
          : router.connect(trader).multicall(data, { value })
      }

      it('0 -> 1', async () => {
        const pool = await factory.getPool(tokens[0].target, tokens[1].target, FeeAmount.MEDIUM)

        // get balances before
        const poolBefore = await getBalances(pool)
        const traderBefore = await getBalances(trader.address)

        await exactInputSingle(tokens[0].target, tokens[1].target)

        // get balances after
        const poolAfter = await getBalances(pool)
        const traderAfter = await getBalances(trader.address)

        expect(traderAfter.token0).to.be.eq(traderBefore.token0 - 3n)
        expect(traderAfter.token1).to.be.eq(traderBefore.token1 + 1n)
        expect(poolAfter.token0).to.be.eq(poolBefore.token0 + 3n)
        expect(poolAfter.token1).to.be.eq(poolBefore.token1 - 1n)
      })

      it('1 -> 0', async () => {
        const pool = await factory.getPool(tokens[1].target, tokens[0].target, FeeAmount.MEDIUM)

        // get balances before
        const poolBefore = await getBalances(pool)
        const traderBefore = await getBalances(trader.address)

        await exactInputSingle(tokens[1].target, tokens[0].target)

        // get balances after
        const poolAfter = await getBalances(pool)
        const traderAfter = await getBalances(trader.address)

        expect(traderAfter.token0).to.be.eq(traderBefore.token0 + 1n)
        expect(traderAfter.token1).to.be.eq(traderBefore.token1 - 3n)
        expect(poolAfter.token0).to.be.eq(poolBefore.token0 - 1n)
        expect(poolAfter.token1).to.be.eq(poolBefore.token1 + 3n)
      })

      describe('ETH input', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].target)
          })

          it('WETH9 -> 0', async () => {
            const pool = await factory.getPool(weth9.target, tokens[0].target, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactInputSingle(weth9.target, tokens[0].target))
              .to.emit(weth9, 'Deposit')
              .withArgs(router.target, 3)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0 + 1n)
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9 + 3n)
            expect(poolAfter.token0).to.be.eq(poolBefore.token0 - 1n)
          })
        })
      })

      describe('ETH output', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].target)
            await createPoolWETH9(tokens[1].target)
          })

          it('0 -> WETH9', async () => {
            const pool = await factory.getPool(tokens[0].target, weth9.target, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactInputSingle(tokens[0].target, weth9.target))
              .to.emit(weth9, 'Withdrawal')
              .withArgs(router.target, 1)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0 - 3n)
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9 - 1n)
            expect(poolAfter.token0).to.be.eq(poolBefore.token0 + 3n)
          })
        })
      })
    })

    describe('#exactOutput', () => {
      async function exactOutput(
        tokenAddresses: string[],
        amountOut: number = 1,
        amountInMaximum: number = 3
      ): Promise<any> {
        const inputIsWETH9 = tokenAddresses[0] === weth9.target
        const outputIsWETH9 = tokenAddresses[tokenAddresses.length - 1] === weth9.target

        const value = inputIsWETH9 ? amountInMaximum : 0

        const params = {
          path: encodePath(tokenAddresses.slice().reverse(), new Array(tokenAddresses.length - 1).fill(FeeAmount.MEDIUM)),
          recipient: outputIsWETH9 ? ethers.ZeroAddress : trader.address,
          deadline: 1,
          amountOut,
          amountInMaximum,
        }

        const data = [router.interface.encodeFunctionData('exactOutput', [params])]
        if (inputIsWETH9) data.push(router.interface.encodeFunctionData('unwrapWETH9', [0, trader.address]))
        if (outputIsWETH9) data.push(router.interface.encodeFunctionData('unwrapWETH9', [amountOut, trader.address]))

        // ensure that the swap fails if the limit is any tighter
        params.amountInMaximum -= 1
        await expect(router.connect(trader).exactOutput(params, { value })).to.be.revertedWith('Too much requested')
        params.amountInMaximum += 1

        return router.connect(trader).multicall(data, { value })
      }

      describe('single-pool', () => {
        it('0 -> 1', async () => {
          const pool = await factory.getPool(tokens[0].target, tokens[1].target, FeeAmount.MEDIUM)

          // get balances before
          const poolBefore = await getBalances(pool)
          const traderBefore = await getBalances(trader.address)

          await exactOutput(tokens.slice(0, 2).map((token) => token.target))

          // get balances after
          const poolAfter = await getBalances(pool)
          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token0).to.be.eq(traderBefore.token0 - 3n)
          expect(traderAfter.token1).to.be.eq(traderBefore.token1 + 1n)
          expect(poolAfter.token0).to.be.eq(poolBefore.token0 + 3n)
          expect(poolAfter.token1).to.be.eq(poolBefore.token1 - 1n)
        })

        it('1 -> 0', async () => {
          const pool = await factory.getPool(tokens[1].target, tokens[0].target, FeeAmount.MEDIUM)

          // get balances before
          const poolBefore = await getBalances(pool)
          const traderBefore = await getBalances(trader.address)

          await exactOutput(
            tokens
              .slice(0, 2)
              .reverse()
              .map((token) => token.target)
          )

          // get balances after
          const poolAfter = await getBalances(pool)
          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token0).to.be.eq(traderBefore.token0 + 1n)
          expect(traderAfter.token1).to.be.eq(traderBefore.token1 - 3n)
          expect(poolAfter.token0).to.be.eq(poolBefore.token0 - 1n)
          expect(poolAfter.token1).to.be.eq(poolBefore.token1 + 3n)
        })
      })

      describe('multi-pool', () => {
        it('0 -> 1 -> 2', async () => {
          const traderBefore = await getBalances(trader.address)

          await exactOutput(
            tokens.map((token) => token.target),
            1,
            5
          )

          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token0).to.be.eq(traderBefore.token0 - 5n)
          expect(traderAfter.token2).to.be.eq(traderBefore.token2 + 1n)
        })

        it('2 -> 1 -> 0', async () => {
          const traderBefore = await getBalances(trader.address)

          await exactOutput(tokens.map((token) => token.target).reverse(), 1, 5)

          const traderAfter = await getBalances(trader.address)

          expect(traderAfter.token2).to.be.eq(traderBefore.token2 - 5n)
          expect(traderAfter.token0).to.be.eq(traderBefore.token0 + 1n)
        })

        it('events', async () => {
          await expect(
            exactOutput(
              tokens.map((token) => token.target),
              1,
              5
            )
          )
            .to.emit(tokens[2], 'Transfer')
            .withArgs(
              computePoolAddress(factory.target, [tokens[2].target, tokens[1].target], FeeAmount.MEDIUM),
              trader.address,
              1
            )
            .to.emit(tokens[1], 'Transfer')
            .withArgs(
              computePoolAddress(factory.target, [tokens[1].target, tokens[0].target], FeeAmount.MEDIUM),
              computePoolAddress(factory.target, [tokens[2].target, tokens[1].target], FeeAmount.MEDIUM),
              3
            )
            .to.emit(tokens[0], 'Transfer')
            .withArgs(
              trader.address,
              computePoolAddress(factory.target, [tokens[1].target, tokens[0].target], FeeAmount.MEDIUM),
              5
            )
        })
      })

      describe('ETH input', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].target)
          })

          it('WETH9 -> 0', async () => {
            const pool = await factory.getPool(weth9.target, tokens[0].target, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactOutput([weth9.target, tokens[0].target]))
              .to.emit(weth9, 'Deposit')
              .withArgs(router.target, 3)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0 + 1n)
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9 + 3n)
            expect(poolAfter.token0).to.be.eq(poolBefore.token0 - 1n)
          })

          it('WETH9 -> 0 -> 1', async () => {
            const traderBefore = await getBalances(trader.address)

            await expect(exactOutput([weth9.target, tokens[0].target, tokens[1].target], 1, 5))
              .to.emit(weth9, 'Deposit')
              .withArgs(router.target, 5)

            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token1).to.be.eq(traderBefore.token1 + 1n)
          })
        })
      })

      describe('ETH output', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].target)
            await createPoolWETH9(tokens[1].target)
          })

          it('0 -> WETH9', async () => {
            const pool = await factory.getPool(tokens[0].target, weth9.target, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactOutput([tokens[0].target, weth9.target]))
              .to.emit(weth9, 'Withdrawal')
              .withArgs(router.target, 1)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0 - 3n)
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9 - 1n)
            expect(poolAfter.token0).to.be.eq(poolBefore.token0 + 3n)
          })

          it('0 -> 1 -> WETH9', async () => {
            // get balances before
            const traderBefore = await getBalances(trader.address)

            await expect(exactOutput([tokens[0].target, tokens[1].target, weth9.target], 1, 5))
              .to.emit(weth9, 'Withdrawal')
              .withArgs(router.target, 1)

            // get balances after
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0 - 5n)
          })
        })
      })
    })

    describe('#exactOutputSingle', () => {
      async function exactOutputSingle(
        tokenIn: string,
        tokenOut: string,
        amountOut: number = 1,
        amountInMaximum: number = 3,
        sqrtPriceLimitX96?: bigint
      ): Promise<any> {
        const inputIsWETH9 = tokenIn === weth9.target
        const outputIsWETH9 = tokenOut === weth9.target

        const value = inputIsWETH9 ? amountInMaximum : 0

        const params = {
          tokenIn,
          tokenOut,
          fee: FeeAmount.MEDIUM,
          recipient: outputIsWETH9 ? ethers.ZeroAddress : trader.address,
          deadline: 1,
          amountOut,
          amountInMaximum,
          sqrtPriceLimitX96:
            sqrtPriceLimitX96 ?? tokenIn.toLowerCase() < tokenOut.toLowerCase()
              ? 4295128740n
              : 1461446703485210103287273052203988822378723970341n,
        }

        const data = [router.interface.encodeFunctionData('exactOutputSingle', [params])]
        if (inputIsWETH9) data.push(router.interface.encodeFunctionData('refundETH'))
        if (outputIsWETH9) data.push(router.interface.encodeFunctionData('unwrapWETH9', [amountOut, trader.address]))

        // ensure that the swap fails if the limit is any tighter
        params.amountInMaximum -= 1
        await expect(router.connect(trader).exactOutputSingle(params, { value })).to.be.revertedWith(
          'Too much requested'
        )
        params.amountInMaximum += 1

        return router.connect(trader).multicall(data, { value })
      }

      it('0 -> 1', async () => {
        const pool = await factory.getPool(tokens[0].target, tokens[1].target, FeeAmount.MEDIUM)

        // get balances before
        const poolBefore = await getBalances(pool)
        const traderBefore = await getBalances(trader.address)

        await exactOutputSingle(tokens[0].target, tokens[1].target)

        // get balances after
        const poolAfter = await getBalances(pool)
        const traderAfter = await getBalances(trader.address)

        expect(traderAfter.token0).to.be.eq(traderBefore.token0 - 3n)
        expect(traderAfter.token1).to.be.eq(traderBefore.token1 + 1n)
        expect(poolAfter.token0).to.be.eq(poolBefore.token0 + 3n)
        expect(poolAfter.token1).to.be.eq(poolBefore.token1 - 1n)
      })

      it('1 -> 0', async () => {
        const pool = await factory.getPool(tokens[1].target, tokens[0].target, FeeAmount.MEDIUM)

        // get balances before
        const poolBefore = await getBalances(pool)
        const traderBefore = await getBalances(trader.address)

        await exactOutputSingle(tokens[1].target, tokens[0].target)

        // get balances after
        const poolAfter = await getBalances(pool)
        const traderAfter = await getBalances(trader.address)

        expect(traderAfter.token0).to.be.eq(traderBefore.token0 + 1n)
        expect(traderAfter.token1).to.be.eq(traderBefore.token1 - 3n)
        expect(poolAfter.token0).to.be.eq(poolBefore.token0 - 1n)
        expect(poolAfter.token1).to.be.eq(poolBefore.token1 + 3n)
      })

      describe('ETH input', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].target)
          })

          it('WETH9 -> 0', async () => {
            const pool = await factory.getPool(weth9.target, tokens[0].target, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactOutputSingle(weth9.target, tokens[0].target))
              .to.emit(weth9, 'Deposit')
              .withArgs(router.target, 3)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0 + 1n)
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9 + 3n)
            expect(poolAfter.token0).to.be.eq(poolBefore.token0 - 1n)
          })
        })
      })

      describe('ETH output', () => {
        describe('WETH9', () => {
          beforeEach(async () => {
            await createPoolWETH9(tokens[0].target)
            await createPoolWETH9(tokens[1].target)
          })

          it('0 -> WETH9', async () => {
            const pool = await factory.getPool(tokens[0].target, weth9.target, FeeAmount.MEDIUM)

            // get balances before
            const poolBefore = await getBalances(pool)
            const traderBefore = await getBalances(trader.address)

            await expect(exactOutputSingle(tokens[0].target, weth9.target))
              .to.emit(weth9, 'Withdrawal')
              .withArgs(router.target, 1)

            // get balances after
            const poolAfter = await getBalances(pool)
            const traderAfter = await getBalances(trader.address)

            expect(traderAfter.token0).to.be.eq(traderBefore.token0 - 3n)
            expect(poolAfter.weth9).to.be.eq(poolBefore.weth9 - 1n)
            expect(poolAfter.token0).to.be.eq(poolBefore.token0 + 3n)
          })
        })
      })
    })

    describe('*WithFee', () => {
      const feeRecipient = '0xfEE0000000000000000000000000000000000000'

      it('#sweepTokenWithFee', async () => {
        const amountOutMinimum = 100
        const params = {
          path: encodePath([tokens[0].target, tokens[1].target], [FeeAmount.MEDIUM]),
          recipient: router.target,
          deadline: 1,
          amountIn: 102,
          amountOutMinimum,
        }

        const data = [
          router.interface.encodeFunctionData('exactInput', [params]),
          router.interface.encodeFunctionData('sweepTokenWithFee', [
            tokens[1].target,
            amountOutMinimum,
            trader.address,
            100,
            feeRecipient,
          ]),
        ]

        await router.connect(trader).multicall(data)

        const balance = await tokens[1].balanceOf(feeRecipient)
        expect(balance === 1n).to.be.eq(true)
      })

      it('#unwrapWETH9WithFee', async () => {
        const startBalance = await ethers.provider.getBalance(feeRecipient)
        await createPoolWETH9(tokens[0].target)

        const amountOutMinimum = 100
        const params = {
          path: encodePath([tokens[0].target, weth9.target], [FeeAmount.MEDIUM]),
          recipient: router.target,
          deadline: 1,
          amountIn: 102,
          amountOutMinimum,
        }

        const data = [
          router.interface.encodeFunctionData('exactInput', [params]),
          router.interface.encodeFunctionData('unwrapWETH9WithFee', [
            amountOutMinimum,
            trader.address,
            100,
            feeRecipient,
          ]),
        ]

        await router.connect(trader).multicall(data)
        const endBalance = await ethers.provider.getBalance(feeRecipient)
        expect(endBalance - startBalance === 1n).to.be.eq(true)
      })
    })
  })
})
