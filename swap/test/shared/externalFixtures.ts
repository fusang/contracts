import { abi as FACTORY_V2_ABI, bytecode as FACTORY_V2_BYTECODE } from '@uniswap/v2-core/build/UniswapV2Factory.json'
import { ethers } from 'hardhat'

import WETH9 from '../contracts/WETH9.json'

async function wethFixture() {
  const signers = await ethers.getSigners()
  const weth9Factory = new ethers.ContractFactory(WETH9.abi, WETH9.bytecode, signers[0])
  const weth9 = await weth9Factory.deploy()
  return { weth9 }
}

export async function v2FactoryFixture() {
  const signers = await ethers.getSigners()
  const factoryFactory = new ethers.ContractFactory(FACTORY_V2_ABI, FACTORY_V2_BYTECODE, signers[0])
  const factory = await factoryFactory.deploy(ethers.ZeroAddress)
  return { factory }
}

async function v3CoreFactoryFixture() {
  const signers = await ethers.getSigners()

  // Deploy WalletList for admin role management
  const walletListFactory = await ethers.getContractFactory('WalletList')
  const walletList = await walletListFactory.deploy()

  // Deploy FusangAllowList (uses walletList for admin)
  const allowListFactory = await ethers.getContractFactory('FusangAllowList')
  const allowList = await allowListFactory.deploy(walletList.target)

  // Deploy FusangFactory with allowList
  const factoryFactory = await ethers.getContractFactory('FusangFactory')
  const factory = await factoryFactory.deploy(allowList.target)
  return { factory, allowList, walletList }
}

export async function v3RouterFixture() {
  const signers = await ethers.getSigners()
  const { weth9 } = await wethFixture()
  const { factory, allowList, walletList } = await v3CoreFactoryFixture()

  // Make all signers admins via WalletList (skip first one - already admin from constructor)
  const DEFAULT_ADMIN_ROLE = await walletList.DEFAULT_ADMIN_ROLE()
  for (let i = 1; i < signers.length; i++) {
    await walletList.addToList(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE, await signers[i].getAddress())
  }

  const router = await (
    await ethers.getContractFactory('MockTimeSwapRouter')
  ).deploy(factory.target, weth9.target)

  // Add router to allowList so it can interact with pools
  await allowList.setAllowed(router.target, true)

  return { factory, allowList, walletList, weth9, router }
}
