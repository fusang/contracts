// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import {IFusangFactory} from './interfaces/IFusangFactory.sol';
import {IFusangAllowList} from './interfaces/IFusangAllowList.sol';

import {UniswapV3PoolDeployer} from './core/UniswapV3PoolDeployer.sol';
import {NoDelegateCall} from './core/NoDelegateCall.sol';

import {UniswapV3Pool} from './core/UniswapV3Pool.sol';

/// @title Fusang Factory
/// @author Fusang — Modified 2025-12-16
/// @notice Deploys Uniswap V3 pools with admin-based access control via AllowList and WalletList
/// @dev Admin checks delegate to AllowList (single source of truth for WalletList reference). All state-changing functions require admin only.
contract FusangFactory is IFusangFactory, UniswapV3PoolDeployer, NoDelegateCall {
    /// @inheritdoc IFusangFactory
    mapping(uint24 => int24) public override feeAmountTickSpacing;
    /// @inheritdoc IFusangFactory
    mapping(address => mapping(address => mapping(uint24 => address))) public override getPool;
    IFusangAllowList private immutable _allowListContract;

    function _isAdmin() private view {
        if (!isAdmin(msg.sender))
            revert NotAdmin(msg.sender);
    }

    constructor(address _allowList) {
        _allowListContract = IFusangAllowList(_allowList);
        feeAmountTickSpacing[500] = 10;
        emit FeeAmountEnabled(500, 10);
        feeAmountTickSpacing[3000] = 60;
        emit FeeAmountEnabled(3000, 60);
        feeAmountTickSpacing[10000] = 200;
        emit FeeAmountEnabled(10000, 200);
    }

    /// @inheritdoc IFusangFactory
    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external override noDelegateCall returns (address pool) {
        _isAdmin();
        require(tokenA != tokenB);
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0));
        int24 tickSpacing = feeAmountTickSpacing[fee];
        require(tickSpacing != 0);
        require(getPool[token0][token1][fee] == address(0));
        pool = deploy(address(this), token0, token1, fee, tickSpacing);
        getPool[token0][token1][fee] = pool;
        // populate mapping in the reverse direction, deliberate choice to avoid the cost of comparing addresses
        getPool[token1][token0][fee] = pool;
        emit PoolCreated(token0, token1, fee, tickSpacing, pool);
    }

    /// @inheritdoc IFusangFactory
    function enableFeeAmount(uint24 fee, int24 tickSpacing) external override {
        _isAdmin();
        require(fee < 1000000);
        // tick spacing is capped at 16384 to prevent the situation where tickSpacing is so large that
        // TickBitmap#nextInitializedTickWithinOneWord overflows int24 container from a valid tick
        // 16384 ticks represents a >5x price change with ticks of 1 bips
        require(tickSpacing > 0 && tickSpacing < 16384);
        require(feeAmountTickSpacing[fee] == 0);

        feeAmountTickSpacing[fee] = tickSpacing;
        emit FeeAmountEnabled(fee, tickSpacing);
    }

    /// @inheritdoc IFusangFactory
    function allowList() external view override returns (address) {
        return address(_allowListContract);
    }

    /// @inheritdoc IFusangFactory
    function walletList() external view override returns (address) {
        return _allowListContract.walletList();
    }

    /// @inheritdoc IFusangFactory
    function isAdmin(address account) public view override returns (bool) {
        return _allowListContract.isAdmin(account);
    }
}
