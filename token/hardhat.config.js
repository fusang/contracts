require('dotenv').config({ path: __dirname + '/.env' })

require('@nomicfoundation/hardhat-toolbox')
require('hardhat-gas-reporter')
// import config before anything else
const { MNEMONIC, ETHERSCAN_API_KEY, COINMARKETCAP_API_KEY, INFURA_API_KEY } = process.env

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
  solidity: {
    compilers: [
      {
        version: '0.8.28',
        settings: {
          evmVersion: 'paris',
          viaIR: false,
          optimizer: {
            enabled: true,
            runs: 1000000,
          },
          metadata: {
            bytecodeHash: 'ipfs',
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
    },
    local: {
      url: 'http://localhost:8545',
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
    baseSepolia: {
      url: `https://base-sepolia.infura.io/v3/${INFURA_API_KEY}`,
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
  },
  plugins: ['solidity-coverage'],
  gasReporter: {
    currency: 'USD',
    enabled: true,
    coinmarketcap: COINMARKETCAP_API_KEY,
    L1Etherscan: ETHERSCAN_API_KEY,
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
}

module.exports = config
