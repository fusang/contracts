import * as dotenv from "dotenv";
dotenv.config({ path: __dirname + "/.env" });

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-gas-reporter";
import "hardhat-contract-sizer";
import "@nomicfoundation/hardhat-verify";

const { MNEMONIC, ETHERSCAN_API_KEY, COINMARKETCAP_API_KEY, INFURA_API_KEY } =
  process.env;

const LOW_OPTIMIZER_COMPILER_SETTINGS = {
  version: "0.8.30",
  settings: {
    evmVersion: "paris" as const,
    optimizer: {
      enabled: true,
      runs: 2000,
    },
    metadata: {
      bytecodeHash: "none" as const,
    },
  },
};

const LOWEST_OPTIMIZER_COMPILER_SETTINGS = {
  version: "0.8.30",
  settings: {
    evmVersion: "paris" as const,
    viaIR: true,
    optimizer: {
      enabled: true,
      runs: 1000,
    },
    metadata: {
      bytecodeHash: "none" as const,
    },
  },
};

const DEFAULT_OPTIMIZER_COMPILER_SETTINGS = {
  version: "0.8.30",
  settings: {
    evmVersion: "paris" as const,
    viaIR: true,
    optimizer: {
      enabled: true,
      runs: 200,
    },
    metadata: {
      bytecodeHash: "none" as const,
    },
  },
};

const config: HardhatUserConfig = {
  solidity: {
    compilers: [DEFAULT_OPTIMIZER_COMPILER_SETTINGS],
    overrides: {
      "contracts/periphery/NonfungiblePositionManager.sol":
        LOW_OPTIMIZER_COMPILER_SETTINGS,
      "contracts/periphery/test/NFTDescriptorTest.sol":
        LOWEST_OPTIMIZER_COMPILER_SETTINGS,
      "contracts/periphery/NonfungibleTokenPositionDescriptor.sol":
        LOWEST_OPTIMIZER_COMPILER_SETTINGS,
      "contracts/periphery/libraries/NFTDescriptor.sol":
        LOWEST_OPTIMIZER_COMPILER_SETTINGS,
      "contracts/periphery/libraries/NFTSVG.sol":
        LOWEST_OPTIMIZER_COMPILER_SETTINGS,
    },
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
    },
    local: {
      url: "http://localhost:8545",
      accounts: {
        mnemonic: MNEMONIC || "",
      },
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: {
        mnemonic: MNEMONIC || "",
      },
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
      accounts: {
        mnemonic: MNEMONIC || "",
      },
    },
  },
  gasReporter: {
    currency: "USD",
    enabled: true,
    coinmarketcap: COINMARKETCAP_API_KEY,
    L1Etherscan: ETHERSCAN_API_KEY,
  },
  etherscan: {
    apiKey: {
      baseSepolia: ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
  sourcify: {
    enabled: true,
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v6",
  },
};

export default config;
