import { expect } from 'chai'
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { POOL_BYTECODE_HASH } from '../shared/computePoolAddress'

describe('PoolAddress', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let poolAddress: any

  async function poolAddressTestFixture() {
    const poolAddressTestFactory = await ethers.getContractFactory('PoolAddressTest')
    return await poolAddressTestFactory.deploy()
  }

  beforeEach('deploy PoolAddressTest', async () => {
    poolAddress = await loadFixture(poolAddressTestFixture)
  })

  describe('#POOL_INIT_CODE_HASH', () => {
    it('equals the hash of the pool bytecode', async () => {
      expect(await poolAddress.POOL_INIT_CODE_HASH()).to.eq(POOL_BYTECODE_HASH)
    })
  })

  describe('#computeAddress', () => {
    it('all arguments equal zero', async () => {
      await expect(poolAddress.computeAddress(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, 0))
        .to.be.reverted
    })

    it('matches example from core repo', async () => {
      expect(
        await poolAddress.computeAddress(
          '0x5FbDB2315678afecb367f032d93F642f64180aa3',
          '0x1000000000000000000000000000000000000000',
          '0x2000000000000000000000000000000000000000',
          250
        )
      ).to.eq('0x6CCe50078377c4c9721e3a71D52496fa2Cf17702')
    })

    it('token argument order cannot be in reverse', async () => {
      await expect(
        poolAddress.computeAddress(
          '0x5FbDB2315678afecb367f032d93F642f64180aa3',
          '0x2000000000000000000000000000000000000000',
          '0x1000000000000000000000000000000000000000',
          3000
        )
      ).to.be.reverted
    })
  })
})
