import { ethers } from 'hardhat'
import { v3RouterFixture } from './externalFixtures'

async function completeFixture() {
  const signers = await ethers.getSigners()
  const { weth9, factory, allowList, walletList, router } = await v3RouterFixture()

  // Admins are already added in v3RouterFixture()

  const tokenFactory = await ethers.getContractFactory('contracts/periphery/test/TestERC20.sol:TestERC20')
  const tokens: [any, any, any] = [
    await tokenFactory.deploy(ethers.MaxUint256 / 2n),
    await tokenFactory.deploy(ethers.MaxUint256 / 2n),
    await tokenFactory.deploy(ethers.MaxUint256 / 2n),
  ]

  const nftDescriptorLibraryFactory = await ethers.getContractFactory('NFTDescriptor')
  const nftDescriptorLibrary = await nftDescriptorLibraryFactory.deploy()
  const positionDescriptorFactory = await ethers.getContractFactory('NonfungibleTokenPositionDescriptor', {
    libraries: {
      NFTDescriptor: nftDescriptorLibrary.target,
    },
  })
  const nftDescriptor = await positionDescriptorFactory.deploy(
    tokens[0].target,
    // 'ETH' as a bytes32 string
    '0x4554480000000000000000000000000000000000000000000000000000000000'
  )

  const positionManagerFactory = await ethers.getContractFactory('MockTimeNonfungiblePositionManager')

  const nft = await positionManagerFactory.deploy(
    factory.target,
    weth9.target,
    nftDescriptor.target
  )

  // Add nft to allowlist
  await allowList.setAllowed(nft.target, true)

  tokens.sort((a, b) => (a.target.toLowerCase() < b.target.toLowerCase() ? -1 : 1))

  return {
    weth9,
    factory,
    allowList,
    walletList,
    router,
    tokens,
    nft,
    nftDescriptor,
  }
}

export default completeFixture
