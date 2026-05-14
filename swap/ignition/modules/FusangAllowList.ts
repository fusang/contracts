// @ts-nocheck
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const FusangAllowListModule = buildModule("FusangAllowListModule", (m) => {
  // Parameter: existing WalletList address
  const walletListAddress = m.getParameter("walletList");

  // Use existing WalletList from parameter
  const walletList = m.contractAt("WalletList", walletListAddress);

  // Deploy FusangAllowList (depends on WalletList)
  const fusangAllowList = m.contract("FusangAllowList", [walletList]);

  return {
    walletList,
    fusangAllowList,
  };
});

export default FusangAllowListModule;
