// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import "../periphery/interfaces/INonfungiblePositionManager.sol";

interface IFusangNonfungiblePositionManager is INonfungiblePositionManager {
    struct RemovePositionParams {
        uint256 tokenId;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    /// @notice Removes a position NFT (admin-only, pool must be inactive)
    /// @dev Only callable by admin when pool is paused or expired.
    /// Decreases all liquidity, collects tokens to position owner, and burns the NFT.
    /// Normal users should use decreaseLiquidity + collect + burn instead.
    /// @param params The parameters for removing the position
    function removePosition(RemovePositionParams calldata params) external payable;

    /// @notice Removes multiple position NFTs (admin-only, pool must be inactive)
    /// @dev Only callable by admin when pool is paused or expired.
    /// @param paramsList The parameters for each position to remove
    function removePositions(RemovePositionParams[] calldata paramsList) external payable;
}
