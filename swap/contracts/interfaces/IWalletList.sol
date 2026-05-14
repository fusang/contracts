// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

/// @title IWalletList
/// @notice Interface for WalletList contract that manages address lists with role-based access control
/// @dev Uses addressList as single source of truth for all permissions
interface IWalletList {
    // State getters
    function addressList(bytes32 listName, address user) external view returns (address);
    function roleManageList(bytes32 listName, bytes32 role) external view returns (bool);

    // Admin check
    function isAdmin(address account) external view returns (bool);

    // List management functions
    function addToList(bytes32 listName, bytes32 role, address user) external;
    function removeFromList(bytes32 listName, bytes32 role, address user) external;
    function batchAddToList(bytes32 listName, bytes32 role, address[] calldata users) external;
    function batchRemoveFromList(bytes32 listName, bytes32 role, address[] calldata users) external;
    function batchAddToListByAdmin(bytes32 listName, bytes32 role, address[] calldata users, address member) external;
    function batchRemoveFromListByAdmin(bytes32 listName, bytes32 role, address[] calldata users, address member) external;
    function isAddressInList(bytes32 listName, address account) external view returns (bool);

    // Role management functions
    function setRoleManageList(bytes32 listName, bytes32 role, bool allowed) external;

    // Events
    event ListChanged(bytes32 indexed listName, address indexed user, address indexed member);
    event ListPermissionChanged(bytes32 indexed listName, bytes32 indexed role, bool allowed);

    // Errors
    error AlreadyListed(address user);
    error NotListed(address user);
    error NoPermission(address user);
    error NoChange();
}
