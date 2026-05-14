module.exports = {
  skipFiles: [
    'test',
    // Skip core except for specific files we want to cover
    'core',
    // Include for coverage:
    // - core/UniswapV3Pool.sol
    // - core/UniswapV3Factory.sol
    // - core/UniswapV3PoolDeployer.sol

    // Skip periphery except for specific files we want to cover
    'periphery/interfaces',
    'periphery/libraries',
    'periphery/lens',
    'periphery/test',
    'periphery/examples',
    'periphery/V3Migrator.sol',
    'periphery/Quoter.sol',
    'periphery/NonfungibleTokenPositionDescriptor.sol',
    'periphery/TickLens.sol',
    'periphery/PairFlash.sol',
    // Skip base contracts except PoolInitializer.sol
    'periphery/base/PeripheryPayments.sol',
    'periphery/base/PeripheryPaymentsWithFee.sol',
    'periphery/base/SelfPermit.sol',
    'periphery/base/ERC721Permit.sol',
    'periphery/base/BlockTimestamp.sol',
    'periphery/base/Multicall.sol',
    'periphery/base/PeripheryImmutableState.sol',
    'periphery/base/PeripheryValidation.sol',
    'periphery/base/LiquidityManagement.sol',
    // Include for coverage:
    // - periphery/NonfungiblePositionManager.sol
    // - periphery/SwapRouter.sol
    // - periphery/QuoterV2.sol
    // - periphery/base/PoolInitializer.sol
  ],
  mocha: {
    grep: "@skip-on-coverage", // Find everything with this tag
    invert: true               // Run the grep's inverse set.
  }
};