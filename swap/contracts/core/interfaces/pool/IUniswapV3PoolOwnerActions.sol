// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2026-04-22:
//   - Add approveToken() for dust token recovery on low-decimal tokens
pragma solidity >=0.5.0;

/// @title Permissioned pool actions
/// @notice Contains pool methods that may only be called by the factory owner
interface IUniswapV3PoolOwnerActions {
    /// @notice Set the denominator of the protocol's % share of the fees
    /// @param feeProtocol0 new protocol fee for token0 of the pool
    /// @param feeProtocol1 new protocol fee for token1 of the pool
    function setFeeProtocol(uint8 feeProtocol0, uint8 feeProtocol1) external;

    /// @notice Collect the protocol fee accrued to the pool
    /// @param recipient The address to which collected protocol fees should be sent
    /// @param amount0Requested The maximum amount of token0 to send, can be 0 to collect fees in only token1
    /// @param amount1Requested The maximum amount of token1 to send, can be 0 to collect fees in only token0
    /// @return amount0 The protocol fee collected in token0
    /// @return amount1 The protocol fee collected in token1
    function collectProtocol(
        address recipient,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external returns (uint128 amount0, uint128 amount1);

    /// @notice Approve a spender to transfer dust tokens held by the pool
    /// @dev Used to collect dust tokens that accumulate from rounding during swap operations.
    /// This is particularly relevant for tokens with 0 decimals,
    /// where integer rounding can leave small residual balances stuck in the pool.
    /// @param token The address of the token to approve
    /// @param spender The address allowed to transfer the tokens
    /// @param amount The amount to approve
    function approveToken(
        address token,
        address spender,
        uint256 amount
    ) external;
}
