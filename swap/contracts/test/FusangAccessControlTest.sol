// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import "../base/FusangAccessControl.sol";

/// @title FusangAccessControlTest
/// @notice Test contract to expose the abstract FusangAccessControl contract for testing
contract FusangAccessControlTest is FusangAccessControl {
    constructor(
        address _factory,
        address _poolStateContract
    ) FusangAccessControl(_factory, _poolStateContract) {}

    /// @notice Exposed function to test onlyAllowed modifier
    function testOnlyAllowed() external onlyAllowed returns (bool) {
        return true;
    }

    /// @notice Exposed function to test _checkRecipientAllowed
    function testCheckRecipientAllowed(address recipient) external view {
        _checkRecipientAllowed(recipient);
    }

    /// @notice Exposed function to test _checkPoolActive
    function testCheckPoolActive(address pool) external view {
        _checkPoolActive(pool);
    }

    /// @notice Exposed function to test _checkPoolNotPaused
    function testCheckPoolNotPaused(address pool) external view {
        _checkPoolNotPaused(pool);
    }
}
