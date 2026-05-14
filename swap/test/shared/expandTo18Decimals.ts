import { parseEther } from "ethers";

export function expandTo18Decimals(n: number): bigint {
  return parseEther(n.toString());
}
