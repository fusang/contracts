// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

/**
 * @title IWalletList
 * @notice Interface for managing multiple address lists with role-based access control
 * @dev Provides a flexible system for managing whitelists, blacklists, frozen lists, and member lists
 *
 * Key Concepts:
 * - Lists: Named collections of addresses (e.g., WHITELIST, FROZENLIST, BLACKLIST, MEMBER)
 * - Roles: Permissions that control who can manage specific lists
 * - Members: Addresses that track which member added a user to a list
 *
 * Common Usage:
 * - MEMBER list: Tracks members who can manage other lists
 * - WHITELIST: Addresses allowed to participate
 * - FROZENLIST: Addresses temporarily restricted
 * - BLACKLIST: Addresses permanently blocked
 */
interface IWalletList {
    // State getters

    /**
     * @notice Returns the member address that added a user to a specific list
     * @param listName The name of the list to query
     * @param user The user address to check
     * @return address The member address that added the user (address(0) if not listed)
     */
    function addressList(bytes32 listName, address user) external view returns (address);

    /**
     * @notice Checks if a role is allowed to manage a specific list
     * @param listName The name of the list to query
     * @param role The role to check
     * @return bool True if the role can manage the list, false otherwise
     */
    function roleManageList(bytes32 listName, bytes32 role) external view returns (bool);

    // List management functions

    /**
     * @notice Adds a user to a specific list
     * @dev Caller must have the required role permission for the list
     * @param listName The name of the list
     * @param role The role required to manage this list
     * @param user The user address to add
     * @custom:throws NoPermission if caller lacks permission
     * @custom:throws AlreadyListed if user is already in the list
     */
    function addToList(bytes32 listName, bytes32 role, address user) external;

    /**
     * @notice Removes a user from a specific list
     * @dev Caller must be the member who originally added the user
     * @param listName The name of the list
     * @param role The role required to manage this list
     * @param user The user address to remove
     * @custom:throws NoPermission if caller lacks permission or didn't add the user
     * @custom:throws NotListed if user is not in the list
     */
    function removeFromList(bytes32 listName, bytes32 role, address user) external;

    /**
     * @notice Adds multiple users to a specific list in a single transaction
     * @dev More gas efficient than multiple addToList calls
     * @param listName The name of the list
     * @param role The role required to manage this list
     * @param users Array of user addresses to add
     */
    function batchAddToList(bytes32 listName, bytes32 role, address[] calldata users) external;

    /**
     * @notice Removes multiple users from a specific list in a single transaction
     * @dev More gas efficient than multiple removeFromList calls
     * @param listName The name of the list
     * @param role The role required to manage this list
     * @param users Array of user addresses to remove
     */
    function batchRemoveFromList(bytes32 listName, bytes32 role, address[] calldata users) external;

    /**
     * @notice Owner-only function to add users on behalf of a specific member
     * @dev Only callable by DEFAULT_ADMIN_ROLE. Useful for migrations or admin operations
     * @param listName The name of the list
     * @param role The role required to manage this list
     * @param users Array of user addresses to add
     * @param member The member address to assign as the manager
     */
    function batchAddToListByAdmin(bytes32 listName, bytes32 role, address[] calldata users, address member) external;

    /**
     * @notice Owner-only function to remove users on behalf of a specific member
     * @dev Only callable by DEFAULT_ADMIN_ROLE. Useful for migrations or admin operations
     * @param listName The name of the list
     * @param role The role required to manage this list
     * @param users Array of user addresses to remove
     * @param member The member address that originally added the users
     */
    function batchRemoveFromListByAdmin(bytes32 listName, bytes32 role, address[] calldata users, address member) external;

    /**
     * @notice Checks if an address is in a specific list
     * @param listName The name of the list to check
     * @param account The address to verify
     * @return bool True if the address is in the list, false otherwise
     */
    function isAddressInList(bytes32 listName, address account) external view returns (bool);

    // Role management functions

    /**
     * @notice Sets whether a role is allowed to manage a specific list
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @param listName The name of the list
     * @param role The role to grant or revoke permission
     * @param allowed True to allow, false to disallow
     */
    function setRoleManageList(bytes32 listName, bytes32 role, bool allowed) external;

    // Events

    /**
     * @notice Emitted when a user is added to or removed from a list
     * @param listName The name of the list that was modified
     * @param user The user address that was added or removed
     * @param member The member address that performed the action (address(0) for removal)
     */
    event ListChanged(bytes32 indexed listName, address indexed user, address indexed member);

    /**
     * @notice Emitted when list permissions are changed for a role
     * @param listName The name of the list
     * @param role The role whose permissions were changed
     * @param allowed The new permission status
     */
    event ListPermissionChanged(bytes32 indexed listName, bytes32 indexed role, bool allowed);

    // Errors

    /**
     * @notice Thrown when attempting to add a user who is already in the list
     * @param user The address that was already listed
     */
    error AlreadyListed(address user);

    /**
     * @notice Thrown when attempting to remove a user who is not in the list
     * @param user The address that was not listed
     */
    error NotListed(address user);

    /**
     * @notice Thrown when caller lacks permission for the requested operation
     * @param user The address that lacked permission
     */
    error NoPermission(address user);

    /**
     * @notice Thrown when attempting to set a role permission that is already set
     */
    error NoChange();
}