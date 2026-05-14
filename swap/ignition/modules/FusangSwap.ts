// @ts-nocheck
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

// Role constants
const WHITELIST = ethers.keccak256(ethers.toUtf8Bytes("WHITELIST"));
const MEMBER = ethers.keccak256(ethers.toUtf8Bytes("MEMBER"));

const FusangSwapModule = buildModule("FusangSwapModule", (m) => {
  // Parameters
  const weth9 = m.getParameter("weth9");
  const nonfungibleTokenPositionDescriptor = m.getParameter(
    "nonfungibleTokenPositionDescriptor"
  );
  const walletListAddress = m.getParameter("walletList");
  const allowListAddress = m.getParameter("allowList");
  const memberAddress = m.getParameter("memberAddress");

  // 1. Use existing WalletList from parameter
  const walletList = m.contractAt("WalletList", walletListAddress);

  // 2. Use existing FusangAllowList from parameter
  const fusangAllowList = m.contractAt("FusangAllowList", allowListAddress);

  // 3. Deploy FusangFactory (depends on WalletList and AllowList)
  const fusangFactory = m.contract("FusangFactory", [walletList, fusangAllowList]);

  // 4. Deploy FusangPoolState (depends on Factory)
  const fusangPoolState = m.contract("FusangPoolState", [fusangFactory]);

  // 5. Deploy FusangSwapRouter (depends on factory, walletList, poolState)
  const fusangSwapRouter = m.contract("FusangSwapRouter", [
    fusangFactory,
    weth9,
    walletList,
    fusangPoolState,
  ]);

  // 6. Deploy FusangNonfungiblePositionManager (depends on factory, walletList, poolState)
  const fusangNonfungiblePositionManager = m.contract(
    "FusangNonfungiblePositionManager",
    [fusangFactory, weth9, nonfungibleTokenPositionDescriptor, walletList, fusangPoolState]
  );

  // 7. Deploy QuoterV2 (depends on factory)
  const quoterV2 = m.contract("QuoterV2", [fusangFactory, weth9]);

  // 8. Batch add contracts to whitelist (via WalletList.batchAddToListByAdmin)
  m.call(walletList, "batchAddToListByAdmin", [WHITELIST, MEMBER, [fusangSwapRouter, fusangNonfungiblePositionManager, quoterV2], memberAddress], {
    id: "batchAddContractsToWhitelist",
  });

  // 9. Batch add contracts to allowlist (via FusangAllowList.batchSetAllowed)
  m.call(fusangAllowList, "batchSetAllowed", [[fusangSwapRouter, fusangNonfungiblePositionManager, quoterV2], true], {
    id: "batchAllowContracts",
  });

  return {
    walletList,
    fusangFactory,
    fusangAllowList,
    fusangPoolState,
    fusangSwapRouter,
    fusangNonfungiblePositionManager,
    quoterV2,
  };
});

export default FusangSwapModule;
