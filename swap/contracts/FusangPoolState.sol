// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import {IFusangPoolState} from './interfaces/IFusangPoolState.sol';
import {IFusangFactory} from './interfaces/IFusangFactory.sol';

/// @title Pool State Management
/// @author Fusang
/// @notice Manages pool close dates and pause states for Uniswap V3 pools
/// @dev Tracks per-pool close dates and pause states, restricted to factory admin
contract FusangPoolState is IFusangPoolState {
    /// @inheritdoc IFusangPoolState
    address public immutable override factory;

    /// @inheritdoc IFusangPoolState
    mapping(address => uint256) public override poolCloseDate;

    /// @inheritdoc IFusangPoolState
    mapping(address => bool) public override isPoolPaused;

    modifier onlyAdmin() {
        if (!IFusangFactory(factory).isAdmin(msg.sender)) {
            revert NotAdmin(msg.sender);
        }
        _;
    }

    constructor(address _factory) {
        factory = _factory;
    }

    /// @inheritdoc IFusangPoolState
    function setPoolCloseDate(address pool, uint256 closeDate) external override onlyAdmin {
        poolCloseDate[pool] = closeDate;
        emit PoolCloseDateSet(pool, closeDate);
    }

    /// @inheritdoc IFusangPoolState
    function pausePool(address pool) external override onlyAdmin {
        if (isPoolPaused[pool]) {
            revert PoolAlreadyPaused(pool);
        }

        isPoolPaused[pool] = true;
        emit PoolPaused(pool);
    }

    /// @inheritdoc IFusangPoolState
    function unpausePool(address pool) external override onlyAdmin {
        if (!isPoolPaused[pool]) {
            revert PoolNotPaused(pool);
        }

        isPoolPaused[pool] = false;
        emit PoolUnpaused(pool);
    }

    /// @notice Check if a pool is currently active (not paused and not past close date)
    /// @param pool The pool address
    /// @return True if the pool is active
    function isPoolActive(address pool) external view returns (bool) {
        if (isPoolPaused[pool]) {
            return false;
        }
        uint256 closeDate = poolCloseDate[pool];
        if (closeDate != 0 && block.timestamp >= closeDate) {
            return false;
        }
        return true;
    }
}
