import { ethers } from "hardhat";
import { bytecode } from "../../artifacts/contracts/core/UniswapV3Pool.sol/UniswapV3Pool.json";

export const POOL_BYTECODE_HASH = ethers.keccak256(bytecode);

export function computePoolAddress(
  factoryAddress: string,
  [tokenA, tokenB]: [string, string],
  fee: number
): string {
  const [token0, token1] =
    tokenA.toLowerCase() < tokenB.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

  const constructorArgumentsEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint24"],
    [token0, token1, fee]
  );

  const salt = ethers.keccak256(constructorArgumentsEncoded);

  const create2Inputs = ["0xff", factoryAddress, salt, POOL_BYTECODE_HASH];

  const sanitizedInputs = `0x${create2Inputs.map((i) => i.slice(2)).join("")}`;
  const addressBytes = ethers.keccak256(sanitizedInputs).slice(-40);

  return ethers.getAddress(`0x${addressBytes}`);
}
