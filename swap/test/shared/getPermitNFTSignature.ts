/* eslint-disable @typescript-eslint/no-explicit-any */
import { ethers, Signature } from 'ethers'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'

export default async function getPermitNFTSignature(
  wallet: HardhatEthersSigner,
  positionManager: any,
  spender: string,
  tokenId: bigint | number,
  deadline: bigint | number = ethers.MaxUint256,
  permitConfig?: { nonce?: bigint | number; name?: string; chainId?: number; version?: string }
): Promise<Signature> {
  const [nonce, name, version, chainId] = await Promise.all([
    permitConfig?.nonce ?? positionManager.positions(tokenId).then((p: any) => p.nonce),
    permitConfig?.name ?? positionManager.name(),
    permitConfig?.version ?? '1',
    permitConfig?.chainId ?? wallet.provider?.getNetwork().then((n) => Number(n.chainId)),
  ])

  const signature = await wallet.signTypedData(
    {
      name,
      version,
      chainId,
      verifyingContract: positionManager.target,
    },
    {
      Permit: [
        {
          name: 'spender',
          type: 'address',
        },
        {
          name: 'tokenId',
          type: 'uint256',
        },
        {
          name: 'nonce',
          type: 'uint256',
        },
        {
          name: 'deadline',
          type: 'uint256',
        },
      ],
    },
    {
      owner: wallet.address,
      spender,
      tokenId,
      nonce,
      deadline,
    }
  )

  return Signature.from(signature)
}
