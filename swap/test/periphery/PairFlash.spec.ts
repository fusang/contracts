/* eslint-disable @typescript-eslint/no-explicit-any */
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import completeFixture from '../shared/completeFixture'
import { FeeAmount, MaxUint128, TICK_SPACINGS } from '../shared/constants'
import { encodePriceSqrt } from '../shared/encodePriceSqrt'
import { expect } from '../shared/expect'
import { getMaxTick, getMinTick } from '../shared/ticks'
import { computePoolAddress } from '../shared/computePoolAddress'

describe('PairFlash test', () => {
  let wallet: HardhatEthersSigner

  let flash: any
  let nft: any
  let token0: any
  let token1: any
  let factory: any
  let quoter: any

  async function createPool(tokenAddressA: string, tokenAddressB: string, fee: FeeAmount, price: string) {
    if (tokenAddressA.toLowerCase() > tokenAddressB.toLowerCase())
      [tokenAddressA, tokenAddressB] = [tokenAddressB, tokenAddressA]

    await factory.createPool(tokenAddressA, tokenAddressB, fee)
    await nft.createAndInitializePoolIfNecessary(tokenAddressA, tokenAddressB, fee, price)

    const liquidityParams = {
      token0: tokenAddressA,
      token1: tokenAddressB,
      fee: fee,
      tickLower: getMinTick(TICK_SPACINGS[fee]),
      tickUpper: getMaxTick(TICK_SPACINGS[fee]),
      recipient: wallet.address,
      amount0Desired: 1000000,
      amount1Desired: 1000000,
      amount0Min: 0,
      amount1Min: 0,
      deadline: 1,
    }

    return nft.mint(liquidityParams)
  }

  const flashFixture = async () => {
    const { router, tokens, factory, weth9, nft, allowList } = await completeFixture()
    const token0 = tokens[0]
    const token1 = tokens[1]

    const flashContractFactory = await ethers.getContractFactory('PairFlash')
    const flash = await flashContractFactory.deploy(router.target, factory.target, weth9.target)

    const quoterFactory = await ethers.getContractFactory('Quoter')
    const quoter = await quoterFactory.deploy(factory.target, weth9.target)

    // Add flash and quoter to allowList so they can interact with pools
    await allowList.setAllowed(flash.target, true)
    await allowList.setAllowed(quoter.target, true)

    return {
      token0,
      token1,
      flash,
      factory,
      weth9,
      nft,
      quoter,
      router,
    }
  }

  before('get wallet', async () => {
    const wallets = await ethers.getSigners()
    wallet = wallets[0]
  })

  beforeEach('load fixture', async () => {
    ;({ factory, token0, token1, flash, nft, quoter } = await loadFixture(flashFixture))

    await token0.approve(nft.target, MaxUint128)
    await token1.approve(nft.target, MaxUint128)
    await createPool(token0.target, token1.target, FeeAmount.LOW, encodePriceSqrt(5, 10))
    await createPool(token0.target, token1.target, FeeAmount.MEDIUM, encodePriceSqrt(1, 1))
    await createPool(token0.target, token1.target, FeeAmount.HIGH, encodePriceSqrt(20, 10))
  })

  describe('flash', () => {
    it('test correct transfer events', async () => {
      //choose amountIn to test
      const amount0In = 1000
      const amount1In = 1000

      const fee0 = Math.ceil((amount0In * FeeAmount.MEDIUM) / 1000000)
      const fee1 = Math.ceil((amount1In * FeeAmount.MEDIUM) / 1000000)

      const flashParams = {
        token0: token0.target,
        token1: token1.target,
        fee1: FeeAmount.MEDIUM,
        amount0: amount0In,
        amount1: amount1In,
        fee2: FeeAmount.LOW,
        fee3: FeeAmount.HIGH,
      }
      // pool1 is the borrow pool
      const pool1 = computePoolAddress(factory.target, [token0.target, token1.target], FeeAmount.MEDIUM)
      const pool2 = computePoolAddress(factory.target, [token0.target, token1.target], FeeAmount.LOW)
      const pool3 = computePoolAddress(factory.target, [token0.target, token1.target], FeeAmount.HIGH)

      const expectedAmountOut0 = await quoter.quoteExactInputSingle.staticCall(
        token1.target,
        token0.target,
        FeeAmount.LOW,
        amount1In,
        encodePriceSqrt(20, 10)
      )
      const expectedAmountOut1 = await quoter.quoteExactInputSingle.staticCall(
        token0.target,
        token1.target,
        FeeAmount.HIGH,
        amount0In,
        encodePriceSqrt(5, 10)
      )

      await expect(flash.initFlash(flashParams))
        .to.emit(token0, 'Transfer')
        .withArgs(pool1, flash.target, amount0In)
        .to.emit(token1, 'Transfer')
        .withArgs(pool1, flash.target, amount1In)
        .to.emit(token0, 'Transfer')
        .withArgs(pool2, flash.target, expectedAmountOut0)
        .to.emit(token1, 'Transfer')
        .withArgs(pool3, flash.target, expectedAmountOut1)
        .to.emit(token0, 'Transfer')
        .withArgs(flash.target, wallet.address, Number(expectedAmountOut0) - amount0In - fee0)
        .to.emit(token1, 'Transfer')
        .withArgs(flash.target, wallet.address, Number(expectedAmountOut1) - amount1In - fee1)
    })
  })
})
