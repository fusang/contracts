// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title Interface for Pool State Management
/// @notice Manages pool close dates and pause states for Uniswap V3 pools
interface IFusangPoolState {
    // Events
    event PoolCloseDateSet(address indexed pool, uint256 closeDate);
    event PoolPaused(address indexed pool);
    event PoolUnpaused(address indexed pool);

    // Errors
    error NotAdmin(address caller);
    error PoolAlreadyPaused(address pool);
    error PoolNotPaused(address pool);

    /// @notice Returns the close date for a pool
    /// @param pool The pool address
    /// @return The close date timestamp (0 if not set)
    function poolCloseDate(address pool) external view returns (uint256);

    /// @notice Returns whether a pool is paused
    /// @param pool The pool address
    /// @return True if the pool is paused
    function isPoolPaused(address pool) external view returns (bool);

    /// @notice Returns the factory address
    /// @return The factory address used for admin checks
    function factory() external view returns (address);

    /// @notice Sets the close date for a pool
    /// @dev Only callable by factory admins
    /// @param pool The pool address
    /// @param closeDate The close date timestamp
    function setPoolCloseDate(address pool, uint256 closeDate) external;

    /// @notice Pauses a pool
    /// @dev Only callable by factory admins
    /// @param pool The pool address
    function pausePool(address pool) external;

    /// @notice Unpauses a pool
    /// @dev Only callable by factory admins
    /// @param pool The pool address
    function unpausePool(address pool) external;

    /// @notice Check if a pool is currently active (not paused and not past close date)
    /// @param pool The pool address
    /// @return True if the pool is active
    function isPoolActive(address pool) external view returns (bool);
}
