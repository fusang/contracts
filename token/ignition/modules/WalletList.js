const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("WalletListModule", (m) => {
    const whitelist = m.contract("WalletList");
    return { whitelist };
});