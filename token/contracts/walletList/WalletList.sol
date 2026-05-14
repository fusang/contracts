// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import './interfaces/IWalletList.sol';
import '@openzeppelin/contracts/access/Ownable2Step.sol';

/**
 * @title WalletList
 * @notice Manages multiple address lists with role-based access control for token compliance
 * @dev Implements IWalletList using addressList as single source of truth for all permissions
 *
 * Architecture:
 * - addressList is the sole permission system (no OZ AccessControl dependency)
 * - Maintains multiple named lists (WHITELIST, FROZENLIST, BLACKLIST, MEMBER)
 * - Tracks which member added each user to a list for accountability
 * - Supports batch operations for gas efficiency
 *
 * Access Control Hierarchy:
 * 1. DEFAULT_ADMIN_ROLE: Addresses in addressList[DEFAULT_ADMIN_ROLE] can perform admin operations
 * 2. MEMBER: Can add/remove users to WHITELIST and FROZENLIST
 * 3. Users: Addresses managed in various lists
 *
 * Data Structure:
 * - addressList[listName][userAddress] => memberAddress
 *   Maps a user in a specific list to the member who added them
 *   address(0) means not in the list
 *
 * - roleManageList[listName][role] => bool
 *   Tracks which roles can manage which lists
 */
contract WalletList is IWalletList, Ownable2Step {
  /// @notice Admin role identifier (matches OZ DEFAULT_ADMIN_ROLE = 0x00 for interface compatibility)
  bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

  /// @notice Role identifier for members who can manage whitelists and frozen lists
  bytes32 public constant MEMBER = keccak256('MEMBER');

  /// @notice List identifier for whitelisted addresses
  bytes32 public constant WHITELIST = keccak256('WHITELIST');

  /// @notice List identifier for frozen addresses
  bytes32 public constant FROZENLIST = keccak256('FROZENLIST');

  /**
   * @notice Maps list names and user addresses to the member who added them
   * @dev Structure: listName => userAddress => memberAddress
   * Examples:
   * - WHITELIST -> ClientAddress => MemberAddress (member who whitelisted the client)
   * - FROZENLIST -> ClientAddress => MemberAddress (member who froze the client)
   * - MEMBER -> MemberAddress => AdminAddress (admin who added the member)
   * - BLACKLIST -> ClientAddress => AdminAddress (admin who blacklisted the client)
   */
  mapping(bytes32 => mapping(address => address)) public addressList;

  /**
   * @notice Maps list names and roles to permission status
   * @dev Structure: listName => role => allowed
   * Examples:
   * - WHITELIST -> MEMBER -> true (members can manage whitelist)
   * - FROZENLIST -> MEMBER -> true (members can manage frozen list)
   */
  mapping(bytes32 => mapping(bytes32 => bool)) public roleManageList;

  error NotAdmin(address account);

  modifier onlyAdmin() {
    if (!isAdmin(msg.sender)) revert NotAdmin(msg.sender);
    _;
  }

  /**
   * @notice Checks if an account has admin privileges
   * @param account The address to check
   * @return True if the account is in the DEFAULT_ADMIN_ROLE list
   */
  function isAdmin(address account) public view returns (bool) {
    return isAddressInList(DEFAULT_ADMIN_ROLE, account);
  }

  /**
   * @notice Initializes the WalletList contract with default permissions
   * @dev Sets up the deployer as admin and configures initial role permissions
   */
  constructor() Ownable(_msgSender()) {
    _setAddressList(DEFAULT_ADMIN_ROLE, msg.sender, msg.sender);
    _setRoleManageList(MEMBER, DEFAULT_ADMIN_ROLE, true);
    _setRoleManageList(WHITELIST, MEMBER, true);
    _setRoleManageList(FROZENLIST, MEMBER, true);
  }

  // #region LIST FUNCTIONS

  /**
   * @notice Adds a user to a specific list
   * @dev Caller must have permission to manage the list. Delegates to _listAction
   * @param listName The name of the list (e.g., WHITELIST, FROZENLIST)
   * @param role The role required to manage this list (e.g., MEMBER)
   * @param user The address to add to the list
   */
  function addToList(bytes32 listName, bytes32 role, address user) external {
    _listAction(listName, role, user, msg.sender, true);
  }

  /**
   * @notice Removes a user from a specific list
   * @dev Caller must be the member who originally added the user. Delegates to _listAction
   * @param listName The name of the list (e.g., WHITELIST, FROZENLIST)
   * @param role The role required to manage this list (e.g., MEMBER)
   * @param user The address to remove from the list
   */
  function removeFromList(bytes32 listName, bytes32 role, address user) external {
    _listAction(listName, role, user, msg.sender, false);
  }

  /**
   * @notice Adds multiple users to a list in a single transaction
   * @dev More gas efficient than multiple addToList calls
   * @param listName The name of the list
   * @param role The role required to manage this list
   * @param users Array of addresses to add
   */
  function batchAddToList(bytes32 listName, bytes32 role, address[] calldata users) external {
    _batchListAction(listName, role, users, msg.sender, true);
  }

  /**
   * @notice Removes multiple users from a list in a single transaction
   * @dev More gas efficient than multiple removeFromList calls
   * @param listName The name of the list
   * @param role The role required to manage this list
   * @param users Array of addresses to remove
   */
  function batchRemoveFromList(bytes32 listName, bytes32 role, address[] calldata users) external {
    _batchListAction(listName, role, users, msg.sender, false);
  }

  /**
   * @notice Admin function to add users on behalf of a specific manager
   * @dev Only callable by DEFAULT_ADMIN_ROLE. Useful for migrations or bulk operations
   * @param listName The name of the list
   * @param role The role required to manage this list
   * @param users Array of addresses to add
   * @param manager The member address to assign as the one who added these users
   */
  function batchAddToListByAdmin(bytes32 listName, bytes32 role, address[] calldata users, address manager) external onlyAdmin {
    require(listName != DEFAULT_ADMIN_ROLE, "Use addAdmin for admin list");
    _batchListAction(listName, role, users, manager, true);
  }

  /**
   * @notice Admin function to force-remove users from a list, bypassing ownership check
   * @dev Only callable by admin. Resolves the deadlock where users would otherwise be
   *      stuck in a list after their original manager has been revoked. The `role` and
   *      `manager` params are retained for interface compatibility but not used.
   * @param listName The name of the list
   * @param users Array of addresses to remove
   */
  function batchRemoveFromListByAdmin(bytes32 listName, bytes32, address[] calldata users, address) external onlyAdmin {
    require(listName != DEFAULT_ADMIN_ROLE, "Use removeAdmin for admin list");
    for (uint256 i = 0; i < users.length; i++) {
      if (addressList[listName][users[i]] == address(0)) revert NotListed(users[i]);
      _setAddressList(listName, users[i], address(0));
    }
  }

  /**
   * @notice Checks if an address is present in a specific list
   * @param listName The name of the list to check
   * @param account The address to verify
   * @return bool True if the address is in the list (managed by any member), false otherwise
   */
  function isAddressInList(bytes32 listName, address account) public view returns (bool) {
    address manager = addressList[listName][account];
    return manager != address(0);
  }
  // #endregion

  /**
   * @notice Internal function to add or remove a user from a list
   * @dev Performs permission checks and validates state transitions
   * @param listName The name of the list
   * @param role The role required to manage this list
   * @param user The user address to add or remove
   * @param manager The member address performing the action
   * @param add True to add, false to remove
   * @custom:throws NoPermission if manager lacks permission
   * @custom:throws AlreadyListed if adding a user who's already in the list
   * @custom:throws NotListed if removing a user who's not in the list
   */
  function _listAction(bytes32 listName, bytes32 role, address user, address manager, bool add) internal {
    _checkRolePermission(listName, role, manager);
    require(user != address(0), 'Invalid address');
    if (add) {
      if (addressList[listName][user] != address(0)) {
        revert AlreadyListed(user);
      }
      _setAddressList(listName, user, manager);
    } else {
      if (addressList[listName][user] == address(0)) {
        revert NotListed(user);
      }
      if (addressList[listName][user] != manager) {
        revert NoPermission(user);
      }
      _setAddressList(listName, user, address(0));
    }
  }

  /**
   * @notice Internal function to update the addressList mapping and emit event
   * @dev Sets the manager for a user in a specific list
   * @param listName The name of the list
   * @param user The user address
   * @param manager The member address (address(0) for removal)
   */
  function _setAddressList(bytes32 listName, address user, address manager) internal {
    addressList[listName][user] = manager;
    emit ListChanged(listName, user, manager);
  }

  /**
   * @notice Internal function to perform batch list operations
   * @dev Iterates through users array and calls _listAction for each
   * @param listName The name of the list
   * @param role The role required to manage this list
   * @param users Array of user addresses
   * @param manager The member address performing the actions
   * @param add True to add users, false to remove
   */
  function _batchListAction(bytes32 listName, bytes32 role, address[] calldata users, address manager, bool add) internal {
    for (uint256 i = 0; i < users.length; i++) {
      _listAction(listName, role, users[i], manager, add);
    }
  }

  /**
   * @notice Sets whether a role is allowed to manage a specific list
   * @dev Only callable by DEFAULT_ADMIN_ROLE
   * @param listName The name of the list
   * @param role The role to grant or revoke permission
   * @param allowed True to allow, false to disallow
   */
  /// @notice Adds an address to the admin list
  /// @dev Only callable by the contract owner (Ownable2Step)
  /// @param account The address to grant admin role
  function addAdmin(address account) external onlyOwner {
    require(account != address(0), "Invalid address");
    if (addressList[DEFAULT_ADMIN_ROLE][account] != address(0)) revert AlreadyListed(account);
    _setAddressList(DEFAULT_ADMIN_ROLE, account, msg.sender);
  }

  /// @notice Removes an address from the admin list
  /// @dev Only callable by the contract owner (Ownable2Step)
  /// @param account The address to revoke admin role
  function removeAdmin(address account) external onlyOwner {
    if (addressList[DEFAULT_ADMIN_ROLE][account] == address(0)) revert NotListed(account);
    _setAddressList(DEFAULT_ADMIN_ROLE, account, address(0));
  }

  function setRoleManageList(bytes32 listName, bytes32 role, bool allowed) external onlyAdmin {
    require(listName != DEFAULT_ADMIN_ROLE, "Admin list managed by owner only");
    _setRoleManageList(listName, role, allowed);
  }

  /**
   * @notice Internal function to update role permissions and emit event
   * @param listName The name of the list
   * @param role The role being granted or revoked permission
   * @param allowed The new permission status
   */
  function _setRoleManageList(bytes32 listName, bytes32 role, bool allowed) internal {
    if (roleManageList[listName][role] == allowed) revert NoChange();
    roleManageList[listName][role] = allowed;
    emit ListPermissionChanged(listName, role, allowed);
  }

  /**
   * @notice Internal function to verify a manager has permission to manage a list
   * @dev Checks both role permission and manager's presence in the role list
   * @param listName The name of the list to manage
   * @param role The role required to manage the list
   * @param manager The address attempting to manage the list
   * @custom:throws NoPermission if role is not allowed or manager doesn't have the role
   */
  function _checkRolePermission(bytes32 listName, bytes32 role, address manager) internal view {
    if (!roleManageList[listName][role] || !isAddressInList(role, manager)) {
      revert NoPermission(manager);
    }
  }
}
