// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title The interface for the Fusang AllowList
/// @notice Minimal interface for allowlist management
interface IFusangAllowList {
    function isAllowed(address account) external view returns (bool);
    function isAdmin(address account) external view returns (bool);
    function walletList() external view returns (address);
    function setAllowed(address account, bool allowed) external;
}
