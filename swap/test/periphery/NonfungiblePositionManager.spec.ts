import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json'
import { BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import completeFixture from '../shared/completeFixture'
import { computePoolAddress } from '../shared/computePoolAddress'
import { FeeAmount, MaxUint128, TICK_SPACINGS } from '../shared/constants'
import { encodePriceSqrt } from '../shared/encodePriceSqrt'
import { expandTo18Decimals } from '../shared/expandTo18Decimals'
import { expect } from '../shared/expect'
import { extractJSONFromURI } from '../shared/extractJSONFromURI'
import getPermitNFTSignature from '../shared/getPermitNFTSignature'
import { encodePath } from '../shared/path'
import poolAtAddress from '../shared/poolAtAddress'
import { getMaxTick, getMinTick } from '../shared/ticks'
import { sortedTokens } from '../shared/tokenSort'

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('NonfungiblePositionManager', () => {
  let wallet: HardhatEthersSigner, other: HardhatEthersSigner

  async function nftFixture() {
    const [wallet, other] = await ethers.getSigners()
    const { weth9, factory, tokens, nft, router, allowList } = await completeFixture()

    // approve & fund wallets
    for (const token of tokens) {
      await token.approve(await nft.getAddress(), ethers.MaxUint256)
      await token.connect(other).approve(await nft.getAddress(), ethers.MaxUint256)
      await token.transfer(await other.getAddress(), expandTo18Decimals(1_000_000))
    }

    return {
      nft,
      factory,
      tokens,
      weth9,
      router,
      wallet,
      allowList,
      other,
    }
  }

  let factory: any
  let nft: any
  let tokens: [any, any, any]
  let weth9: any
  let router: any
  let allowList: any

  beforeEach('load fixture', async () => {
    const fixture = await loadFixture(nftFixture)
    nft = fixture.nft
    factory = fixture.factory
    tokens = fixture.tokens
    weth9 = fixture.weth9
    router = fixture.router
    wallet = fixture.wallet
    other = fixture.other
    allowList = fixture.allowList
  })

  describe('#createAndInitializePoolIfNecessary', () => {
    it('creates the pool at the expected address', async () => {
      const expectedAddress = computePoolAddress(
        await factory.getAddress(),
        [await tokens[0].getAddress(), await tokens[1].getAddress()],
        FeeAmount.MEDIUM
      )
      const code = await wallet.provider.getCode(expectedAddress)
      expect(code).to.eq('0x')
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )
      const codeAfter = await wallet.provider.getCode(expectedAddress)
      expect(codeAfter).to.not.eq('0x')
    })

    it('is payable', async () => {
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1),
        { value: 1 }
      )
    })

    it('works if pool is created but not initialized', async () => {
      const expectedAddress = computePoolAddress(
        await factory.getAddress(),
        [await tokens[0].getAddress(), await tokens[1].getAddress()],
        FeeAmount.MEDIUM
      )
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      const code = await wallet.provider.getCode(expectedAddress)
      expect(code).to.not.eq('0x')
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(2, 1)
      )
    })

    it('works if pool is created and initialized', async () => {
      const expectedAddress = computePoolAddress(
        await factory.getAddress(),
        [await tokens[0].getAddress(), await tokens[1].getAddress()],
        FeeAmount.MEDIUM
      )
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      const pool = new ethers.Contract(expectedAddress, IUniswapV3PoolABI, wallet)
      const [owner] = await ethers.getSigners();
      await allowList.setAllowed(owner, true)
      await pool.initialize(encodePriceSqrt(3, 1))
      const code = await wallet.provider.getCode(expectedAddress)
      expect(code).to.not.eq('0x')
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(4, 1)
      )
    })

    it('could theoretically use eth via multicall', async () => {
      const [token0, token1] = await sortedTokens(weth9, tokens[0])

      await factory.createPool(await token0.getAddress(), await token1.getAddress(), FeeAmount.MEDIUM)
      const createAndInitializePoolIfNecessaryData = nft.interface.encodeFunctionData(
        'createAndInitializePoolIfNecessary',
        [await token0.getAddress(), await token1.getAddress(), FeeAmount.MEDIUM, encodePriceSqrt(1, 1)]
      )

      await nft.multicall([createAndInitializePoolIfNecessaryData], { value: expandTo18Decimals(1) })
    })

    it('fails if token0 > token1 (wrong order)', async () => {
      const token0Addr = await tokens[0].getAddress()
      const token1Addr = await tokens[1].getAddress()

      // Determine which token has higher address to pass in wrong order
      const [lowerToken, higherToken] = BigInt(token0Addr) < BigInt(token1Addr)
        ? [token0Addr, token1Addr]
        : [token1Addr, token0Addr]

      await factory.createPool(lowerToken, higherToken, FeeAmount.MEDIUM)
      // Pass tokens in wrong order (higher address first)
      await expect(
        nft.createAndInitializePoolIfNecessary(
          higherToken,
          lowerToken,
          FeeAmount.MEDIUM,
          encodePriceSqrt(1, 1)
        )
      ).to.be.reverted
    })

    it('succeeds when NFT contract is in allowList', async () => {
      // The NFT contract is in the allowList, so it can create pools
      const isNftAllowed = await allowList.isAllowed(await nft.getAddress())
      expect(isNftAllowed).to.eq(true)

      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      // Create pool should succeed (NFT is in allowList)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      // Verify pool was created
      const poolAddress = await factory.getPool(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM
      )
      expect(poolAddress).to.not.eq(ethers.ZeroAddress)
    })

    it('any user can create pools via NFT since NFT is in allowList', async () => {
      // Even non-admin users can create pools through NFT since NFT itself is in allowList
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.connect(other).createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      // Verify pool was created
      const poolAddress = await factory.getPool(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM
      )
      expect(poolAddress).to.not.eq(ethers.ZeroAddress)
    })
  })

  describe('#mint', () => {
    it('fails if pool does not exist', async () => {
      await expect(
        nft.mint({
          token0: await tokens[0].getAddress(),
          token1: await tokens[1].getAddress(),
          tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          recipient: await wallet.getAddress(),
          deadline: 1,
          fee: FeeAmount.MEDIUM,
        })
      ).to.be.reverted
    })

    it('fails if cannot transfer', async () => {
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )
      await tokens[0].approve(await nft.getAddress(), 0)
      await expect(
        nft.mint({
          token0: await tokens[0].getAddress(),
          token1: await tokens[1].getAddress(),
          fee: FeeAmount.MEDIUM,
          tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          recipient: await wallet.getAddress(),
          deadline: 1,
        })
      ).to.be.revertedWith('STF')
    })

    it('creates a token', async () => {
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      await nft.mint({
        token0: await tokens[0].getAddress(),
        token1: await tokens[1].getAddress(),
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: await other.getAddress(),
        amount0Desired: 15,
        amount1Desired: 15,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 10,
      })
      expect(await nft.balanceOf(await other.getAddress())).to.eq(1)
      expect(await nft.tokenOfOwnerByIndex(await other.getAddress(), 0)).to.eq(1)
      const {
        fee,
        token0,
        token1,
        tickLower,
        tickUpper,
        liquidity,
        tokensOwed0,
        tokensOwed1,
        feeGrowthInside0LastX128,
        feeGrowthInside1LastX128,
      } = await nft.positions(1)
      expect(token0).to.eq(await tokens[0].getAddress())
      expect(token1).to.eq(await tokens[1].getAddress())
      expect(fee).to.eq(FeeAmount.MEDIUM)
      expect(tickLower).to.eq(getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]))
      expect(tickUpper).to.eq(getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]))
      expect(liquidity).to.eq(15)
      expect(tokensOwed0).to.eq(0)
      expect(tokensOwed1).to.eq(0)
      expect(feeGrowthInside0LastX128).to.eq(0)
      expect(feeGrowthInside1LastX128).to.eq(0)
    })

    it('can use eth via multicall', async () => {
      const [token0, token1] = sortedTokens(weth9, tokens[0])

      // remove any approval
      await weth9.approve(await nft.getAddress(), 0)

      await factory.createPool(await token0.getAddress(), await token1.getAddress(), FeeAmount.MEDIUM)
      const createAndInitializeData = nft.interface.encodeFunctionData('createAndInitializePoolIfNecessary', [
        await token0.getAddress(),
        await token1.getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1),
      ])

      const mintData = nft.interface.encodeFunctionData('mint', [
        {
          token0: await token0.getAddress(),
          token1: await token1.getAddress(),
          tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          fee: FeeAmount.MEDIUM,
          recipient: await other.getAddress(),
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          deadline: 1,
        },
      ])

      const refundETHData = nft.interface.encodeFunctionData('refundETH')

      const balanceBefore = await wallet.provider.getBalance(await wallet.getAddress())
      const tx = await nft.multicall([createAndInitializeData, mintData, refundETHData], {
        value: expandTo18Decimals(1),
      })
      const receipt = await tx.wait()
      const balanceAfter = await wallet.provider.getBalance(await wallet.getAddress())
      expect(balanceBefore).to.eq(balanceAfter + BigInt(receipt.gasUsed) * BigInt(tx.gasPrice || 0) + 100n)
    })

    it('emits an event')
  })

  describe('#increaseLiquidity', () => {
    const tokenId = 1
    beforeEach('create a position', async () => {
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      await nft.mint({
        token0: await tokens[0].getAddress(),
        token1: await tokens[1].getAddress(),
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: await other.getAddress(),
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      })
    })

    it('increases position liquidity', async () => {
      await nft.increaseLiquidity({
        tokenId: tokenId,
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      })
      const { liquidity } = await nft.positions(tokenId)
      expect(liquidity).to.eq(1100)
    })

    it('emits an event')

    it('can be paid with ETH', async () => {
      const [token0, token1] = await sortedTokens(tokens[0], weth9)

      const tokenId = 1

      await factory.createPool(await token0.getAddress(), await token1.getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await token0.getAddress(),
        await token1.getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      const mintData = nft.interface.encodeFunctionData('mint', [
        {
          token0: await token0.getAddress(),
          token1: await token1.getAddress(),
          fee: FeeAmount.MEDIUM,
          tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          recipient: await other.getAddress(),
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          deadline: 1,
        },
      ])
      const refundETHData = nft.interface.encodeFunctionData('unwrapWETH9', [0, await other.getAddress()])
      await nft.multicall([mintData, refundETHData], { value: expandTo18Decimals(1) })

      const increaseLiquidityData = nft.interface.encodeFunctionData('increaseLiquidity', [
        {
          tokenId: tokenId,
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          deadline: 1,
        },
      ])
      await nft.multicall([increaseLiquidityData, refundETHData], { value: expandTo18Decimals(1) })
    })
  })

  describe('#decreaseLiquidity', () => {
    const tokenId = 1
    beforeEach('create a position', async () => {
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      await nft.mint({
        token0: await tokens[0].getAddress(),
        token1: await tokens[1].getAddress(),
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: await other.getAddress(),
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      })
    })

    it('emits an event')

    it('fails if past deadline', async () => {
      await nft.setTime(2)
      await expect(
        nft.connect(other).decreaseLiquidity({ tokenId, liquidity: 50, amount0Min: 0, amount1Min: 0, deadline: 1 })
      ).to.be.revertedWith('Transaction too old')
    })

    it('cannot be called by other addresses', async () => {
      await expect(
        nft.decreaseLiquidity({ tokenId, liquidity: 50, amount0Min: 0, amount1Min: 0, deadline: 1 })
      ).to.be.revertedWith('Not approved')
    })

    it('decreases position liquidity', async () => {
      await nft.connect(other).decreaseLiquidity({ tokenId, liquidity: 25, amount0Min: 0, amount1Min: 0, deadline: 1 })
      const { liquidity } = await nft.positions(tokenId)
      expect(liquidity).to.eq(75)
    })

    it('is payable', async () => {
      await nft
        .connect(other)
        .decreaseLiquidity({ tokenId, liquidity: 25, amount0Min: 0, amount1Min: 0, deadline: 1 }, { value: 1 })
    })

    it('accounts for tokens owed', async () => {
      await nft.connect(other).decreaseLiquidity({ tokenId, liquidity: 25, amount0Min: 0, amount1Min: 0, deadline: 1 })
      const { tokensOwed0, tokensOwed1 } = await nft.positions(tokenId)
      expect(tokensOwed0).to.eq(24)
      expect(tokensOwed1).to.eq(24)
    })

    it('can decrease for all the liquidity', async () => {
      await nft.connect(other).decreaseLiquidity({ tokenId, liquidity: 100, amount0Min: 0, amount1Min: 0, deadline: 1 })
      const { liquidity } = await nft.positions(tokenId)
      expect(liquidity).to.eq(0)
    })

    it('cannot decrease for more than all the liquidity', async () => {
      await expect(
        nft.connect(other).decreaseLiquidity({ tokenId, liquidity: 101, amount0Min: 0, amount1Min: 0, deadline: 1 })
      ).to.be.reverted
    })

    it('cannot decrease for more than the liquidity of the nft position', async () => {
      await nft.mint({
        token0: await tokens[0].getAddress(),
        token1: await tokens[1].getAddress(),
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: await other.getAddress(),
        amount0Desired: 200,
        amount1Desired: 200,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      })
      await expect(
        nft.connect(other).decreaseLiquidity({ tokenId, liquidity: 101, amount0Min: 0, amount1Min: 0, deadline: 1 })
      ).to.be.reverted
    })
  })

  describe('#collect', () => {
    const tokenId = 1
    beforeEach('create a position', async () => {
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      await nft.mint({
        token0: await tokens[0].getAddress(),
        token1: await tokens[1].getAddress(),
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: await other.getAddress(),
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      })
    })

    it('emits an event')

    it('cannot be called by other addresses', async () => {
      await expect(
        nft.collect({
          tokenId,
          recipient: await wallet.getAddress(),
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        })
      ).to.be.revertedWith('Not approved')
    })

    it('cannot be called with 0 for both amounts', async () => {
      await expect(
        nft.connect(other).collect({
          tokenId,
          recipient: await wallet.getAddress(),
          amount0Max: 0,
          amount1Max: 0,
        })
      ).to.be.reverted
    })

    it('no op if no tokens are owed', async () => {
      await expect(
        nft.connect(other).collect({
          tokenId,
          recipient: await wallet.getAddress(),
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        })
      )
        .to.not.emit(tokens[0], 'Transfer')
        .to.not.emit(tokens[1], 'Transfer')
    })

    it('transfers tokens owed from burn', async () => {
      await nft.connect(other).decreaseLiquidity({ tokenId, liquidity: 50, amount0Min: 0, amount1Min: 0, deadline: 1 })
      const poolAddress = computePoolAddress(
        await factory.getAddress(),
        [await tokens[0].getAddress(), await tokens[1].getAddress()],
        FeeAmount.MEDIUM
      )
      await expect(
        nft.connect(other).collect({
          tokenId,
          recipient: await wallet.getAddress(),
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        })
      )
        .to.emit(tokens[0], 'Transfer')
        .withArgs(poolAddress, await wallet.getAddress(), 49)
        .to.emit(tokens[1], 'Transfer')
        .withArgs(poolAddress, await wallet.getAddress(), 49)
    })
  })

  describe('#burn', () => {
    const tokenId = 1
    beforeEach('create a position', async () => {
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      await nft.mint({
        token0: await tokens[0].getAddress(),
        token1: await tokens[1].getAddress(),
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: await other.getAddress(),
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      })
    })

    it('emits an event')

    it('cannot be called by other addresses', async () => {
      await expect(nft.burn(tokenId)).to.be.revertedWith('Not approved')
    })

    it('cannot be called while there is still liquidity', async () => {
      await expect(nft.connect(other).burn(tokenId)).to.be.revertedWith('Not cleared')
    })

    it('cannot be called while there is still partial liquidity', async () => {
      await nft.connect(other).decreaseLiquidity({ tokenId, liquidity: 50, amount0Min: 0, amount1Min: 0, deadline: 1 })
      await expect(nft.connect(other).burn(tokenId)).to.be.revertedWith('Not cleared')
    })

    it('cannot be called while there is still tokens owed', async () => {
      await nft.connect(other).decreaseLiquidity({ tokenId, liquidity: 100, amount0Min: 0, amount1Min: 0, deadline: 1 })
      await expect(nft.connect(other).burn(tokenId)).to.be.revertedWith('Not cleared')
    })

    it('deletes the token', async () => {
      await nft.connect(other).decreaseLiquidity({ tokenId, liquidity: 100, amount0Min: 0, amount1Min: 0, deadline: 1 })
      await nft.connect(other).collect({
        tokenId,
        recipient: await wallet.getAddress(),
        amount0Max: MaxUint128,
        amount1Max: MaxUint128,
      })
      await nft.connect(other).burn(tokenId)
      await expect(nft.positions(tokenId)).to.be.revertedWith('Invalid token ID')
    })
  })

  describe('#transferFrom', () => {
    const tokenId = 1
    beforeEach('create a position', async () => {
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      await nft.mint({
        token0: await tokens[0].getAddress(),
        token1: await tokens[1].getAddress(),
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: await other.getAddress(),
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      })
    })

    it('can only be called by authorized or owner', async () => {
      await expect(
        nft.transferFrom(await other.getAddress(), await wallet.getAddress(), tokenId)
      ).to.be.revertedWith('ERC721: transfer caller is not owner nor approved')
    })

    it('changes the owner', async () => {
      await nft.connect(other).transferFrom(await other.getAddress(), await wallet.getAddress(), tokenId)
      expect(await nft.ownerOf(tokenId)).to.eq(await wallet.getAddress())
    })

    it('removes existing approval', async () => {
      await nft.connect(other).approve(await wallet.getAddress(), tokenId)
      expect(await nft.getApproved(tokenId)).to.eq(await wallet.getAddress())
      await nft.transferFrom(await other.getAddress(), await wallet.getAddress(), tokenId)
      expect(await nft.getApproved(tokenId)).to.eq(ethers.ZeroAddress)
    })
  })

  describe('#permit', () => {
    it('emits an event')

    describe('owned by eoa', () => {
      const tokenId = 1
      beforeEach('create a position', async () => {
        await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
        await nft.createAndInitializePoolIfNecessary(
          await tokens[0].getAddress(),
          await tokens[1].getAddress(),
          FeeAmount.MEDIUM,
          encodePriceSqrt(1, 1)
        )

        await nft.mint({
          token0: await tokens[0].getAddress(),
          token1: await tokens[1].getAddress(),
          fee: FeeAmount.MEDIUM,
          tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          recipient: await other.getAddress(),
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          deadline: 1,
        })
      })

      it('changes the operator of the position and increments the nonce', async () => {
        const { v, r, s } = await getPermitNFTSignature(other, nft, await wallet.getAddress(), tokenId, 1)
        await nft.permit(await wallet.getAddress(), tokenId, 1, v, r, s)
        expect((await nft.positions(tokenId)).nonce).to.eq(1)
        expect((await nft.positions(tokenId)).operator).to.eq(await wallet.getAddress())
      })

      it('cannot be called twice with the same signature', async () => {
        const { v, r, s } = await getPermitNFTSignature(other, nft, await wallet.getAddress(), tokenId, 1)
        await nft.permit(await wallet.getAddress(), tokenId, 1, v, r, s)
        await expect(nft.permit(await wallet.getAddress(), tokenId, 1, v, r, s)).to.be.reverted
      })

      it('fails with invalid signature', async () => {
        const { v, r, s } = await getPermitNFTSignature(wallet, nft, await wallet.getAddress(), tokenId, 1)
        await expect(nft.permit(await wallet.getAddress(), tokenId, 1, v + 3, r, s)).to.be.revertedWith(
          'Invalid signature'
        )
      })

      it('fails with signature not from owner', async () => {
        const { v, r, s } = await getPermitNFTSignature(wallet, nft, await wallet.getAddress(), tokenId, 1)
        await expect(nft.permit(await wallet.getAddress(), tokenId, 1, v, r, s)).to.be.revertedWith('Unauthorized')
      })

      it('fails with expired signature', async () => {
        await nft.setTime(2)
        const { v, r, s } = await getPermitNFTSignature(other, nft, await wallet.getAddress(), tokenId, 1)
        await expect(nft.permit(await wallet.getAddress(), tokenId, 1, v, r, s)).to.be.revertedWith('Permit expired')
      })
    })
    describe('owned by verifying contract', () => {
      const tokenId = 1
      let testPositionNFTOwner: any

      beforeEach('deploy test owner and create a position', async () => {
        testPositionNFTOwner = await (await ethers.getContractFactory('TestPositionNFTOwner')).deploy()

        await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
        await nft.createAndInitializePoolIfNecessary(
          await tokens[0].getAddress(),
          await tokens[1].getAddress(),
          FeeAmount.MEDIUM,
          encodePriceSqrt(1, 1)
        )

        await nft.mint({
          token0: await tokens[0].getAddress(),
          token1: await tokens[1].getAddress(),
          fee: FeeAmount.MEDIUM,
          tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          recipient: await testPositionNFTOwner.getAddress(),
          amount0Desired: 100,
          amount1Desired: 100,
          amount0Min: 0,
          amount1Min: 0,
          deadline: 1,
        })
      })

      it('changes the operator of the position and increments the nonce', async () => {
        const { v, r, s } = await getPermitNFTSignature(other, nft, await wallet.getAddress(), tokenId, 1)
        await testPositionNFTOwner.setOwner(await other.getAddress())
        await nft.permit(await wallet.getAddress(), tokenId, 1, v, r, s)
        expect((await nft.positions(tokenId)).nonce).to.eq(1)
        expect((await nft.positions(tokenId)).operator).to.eq(await wallet.getAddress())
      })

      it('fails if owner contract is owned by different address', async () => {
        const { v, r, s } = await getPermitNFTSignature(other, nft, await wallet.getAddress(), tokenId, 1)
        await testPositionNFTOwner.setOwner(await wallet.getAddress())
        await expect(nft.permit(await wallet.getAddress(), tokenId, 1, v, r, s)).to.be.revertedWith('Unauthorized')
      })

      it('fails with signature not from owner', async () => {
        const { v, r, s } = await getPermitNFTSignature(wallet, nft, await wallet.getAddress(), tokenId, 1)
        await testPositionNFTOwner.setOwner(await other.getAddress())
        await expect(nft.permit(await wallet.getAddress(), tokenId, 1, v, r, s)).to.be.revertedWith('Unauthorized')
      })

      it('fails with expired signature', async () => {
        await nft.setTime(2)
        const { v, r, s } = await getPermitNFTSignature(other, nft, await wallet.getAddress(), tokenId, 1)
        await testPositionNFTOwner.setOwner(await other.getAddress())
        await expect(nft.permit(await wallet.getAddress(), tokenId, 1, v, r, s)).to.be.revertedWith('Permit expired')
      })
    })
  })

  describe('multicall exit', () => {
    const tokenId = 1
    beforeEach('create a position', async () => {
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      await nft.mint({
        token0: await tokens[0].getAddress(),
        token1: await tokens[1].getAddress(),
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: await other.getAddress(),
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      })
    })

    async function exit({
      nft,
      liquidity,
      tokenId,
      amount0Min,
      amount1Min,
      recipient,
    }: {
      nft: any
      tokenId: BigNumberish
      liquidity: BigNumberish
      amount0Min: BigNumberish
      amount1Min: BigNumberish
      recipient: string
    }) {
      const decreaseLiquidityData = nft.interface.encodeFunctionData('decreaseLiquidity', [
        { tokenId, liquidity, amount0Min, amount1Min, deadline: 1 },
      ])
      const collectData = nft.interface.encodeFunctionData('collect', [
        {
          tokenId,
          recipient,
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        },
      ])
      const burnData = nft.interface.encodeFunctionData('burn', [tokenId])

      return nft.multicall([decreaseLiquidityData, collectData, burnData])
    }

    it('executes all the actions', async () => {
      await exit({
        nft: nft.connect(other),
        tokenId,
        liquidity: 100,
        amount0Min: 0,
        amount1Min: 0,
        recipient: await wallet.getAddress(),
      })
      expect(await nft.balanceOf(await other.getAddress())).to.eq(0)
    })
  })

  describe('#tokenURI', async () => {
    const tokenId = 1
    beforeEach('create a position', async () => {
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )

      await nft.mint({
        token0: await tokens[0].getAddress(),
        token1: await tokens[1].getAddress(),
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        recipient: await other.getAddress(),
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
      })
    })

    it('reverts for invalid token id', async () => {
      await expect(nft.tokenURI(tokenId + 1)).to.be.reverted
    })

    it('returns a data URI with correct mime type', async () => {
      expect(await nft.tokenURI(tokenId)).to.match(/data:application\/json;base64,.+/)
    })

    it('content is valid JSON and structure', async () => {
      const content = extractJSONFromURI(await nft.tokenURI(tokenId))
      expect(content).to.haveOwnProperty('name').is.a('string')
      expect(content).to.haveOwnProperty('description').is.a('string')
      expect(content).to.haveOwnProperty('image').is.a('string')
    })
  })

  describe('fees accounting', () => {
    beforeEach('create two positions', async () => {
      await factory.createPool(await tokens[0].getAddress(), await tokens[1].getAddress(), FeeAmount.MEDIUM)
      await nft.createAndInitializePoolIfNecessary(
        await tokens[0].getAddress(),
        await tokens[1].getAddress(),
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      )
      // nft 1 earns 25% of fees
      await nft.mint({
        token0: await tokens[0].getAddress(),
        token1: await tokens[1].getAddress(),
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(FeeAmount.MEDIUM),
        tickUpper: getMaxTick(FeeAmount.MEDIUM),
        amount0Desired: 100,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
        recipient: await wallet.getAddress(),
      })
      // nft 2 earns 75% of fees
      await nft.mint({
        token0: await tokens[0].getAddress(),
        token1: await tokens[1].getAddress(),
        fee: FeeAmount.MEDIUM,
        tickLower: getMinTick(FeeAmount.MEDIUM),
        tickUpper: getMaxTick(FeeAmount.MEDIUM),

        amount0Desired: 300,
        amount1Desired: 300,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1,
        recipient: await wallet.getAddress(),
      })
    })

    describe('10k of token0 fees collect', () => {
      beforeEach('swap for ~10k of fees', async () => {
        const swapAmount = 3_333_333
        await tokens[0].approve(await router.getAddress(), swapAmount)
        await router.exactInput({
          recipient: await wallet.getAddress(),
          deadline: 1,
          path: encodePath([await tokens[0].getAddress(), await tokens[1].getAddress()], [FeeAmount.MEDIUM]),
          amountIn: swapAmount,
          amountOutMinimum: 0,
        })
      })
      it('expected amounts', async () => {
        const { amount0: nft1Amount0, amount1: nft1Amount1 } = await nft.collect.staticCall({
          tokenId: 1,
          recipient: await wallet.getAddress(),
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        })
        const { amount0: nft2Amount0, amount1: nft2Amount1 } = await nft.collect.staticCall({
          tokenId: 2,
          recipient: await wallet.getAddress(),
          amount0Max: MaxUint128,
          amount1Max: MaxUint128,
        })
        expect(nft1Amount0).to.eq(2501)
        expect(nft1Amount1).to.eq(0)
        expect(nft2Amount0).to.eq(7503)
        expect(nft2Amount1).to.eq(0)
      })

      it('actually collected', async () => {
        const poolAddress = computePoolAddress(
          await factory.getAddress(),
          [await tokens[0].getAddress(), await tokens[1].getAddress()],
          FeeAmount.MEDIUM
        )

        await expect(
          nft.collect({
            tokenId: 1,
            recipient: await wallet.getAddress(),
            amount0Max: MaxUint128,
            amount1Max: MaxUint128,
          })
        )
          .to.emit(tokens[0], 'Transfer')
          .withArgs(poolAddress, await wallet.getAddress(), 2501)
          .to.not.emit(tokens[1], 'Transfer')
        await expect(
          nft.collect({
            tokenId: 2,
            recipient: await wallet.getAddress(),
            amount0Max: MaxUint128,
            amount1Max: MaxUint128,
          })
        )
          .to.emit(tokens[0], 'Transfer')
          .withArgs(poolAddress, await wallet.getAddress(), 7503)
          .to.not.emit(tokens[1], 'Transfer')
      })
    })
  })
})
