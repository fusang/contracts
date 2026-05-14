// @ts-nocheck
import { abi as POOL_ABI } from '../../artifacts/contracts/core/UniswapV3Pool.sol/UniswapV3Pool.json'
import { Contract, Wallet } from 'ethers'

export default function poolAtAddress(address: string, wallet: Wallet): Contract {
  return new Contract(address, POOL_ABI, wallet)
}
