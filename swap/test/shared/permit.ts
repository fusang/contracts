// @ts-nocheck
import { ethers } from 'hardhat'

export async function getPermitSignature(
  wallet: any,
  token: any,
  spender: string,
  value: bigint | number = ethers.MaxUint256,
  deadline: bigint | number = ethers.MaxUint256,
  permitConfig?: { nonce?: bigint | number; name?: string; chainId?: number; version?: string }
): Promise<{ v: number; r: string; s: string }> {
  const [nonce, name, version, chainId] = await Promise.all([
    permitConfig?.nonce ?? token.nonces(wallet.address),
    permitConfig?.name ?? token.name(),
    permitConfig?.version ?? '1',
    permitConfig?.chainId ?? (await wallet.provider.getNetwork()).chainId,
  ])

  const signature = await wallet.signTypedData(
    {
      name,
      version,
      chainId,
      verifyingContract: token.target,
    },
    {
      Permit: [
        {
          name: 'owner',
          type: 'address',
        },
        {
          name: 'spender',
          type: 'address',
        },
        {
          name: 'value',
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
      value,
      nonce,
      deadline,
    }
  )

  // In ethers v6, we use Signature.from to split the signature
  const sig = ethers.Signature.from(signature)
  return {
    v: sig.v,
    r: sig.r,
    s: sig.s,
  }
}
