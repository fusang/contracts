// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import '../interfaces/IWalletList.sol';
import '../interfaces/IFusangPoolState.sol';
import '../interfaces/IFusangFactory.sol';

/// @title Fusang Access Control
/// @author Fusang
/// @notice Base contract for whitelist and pool state access control
/// @dev Provides reusable access control for Fusang periphery contracts.
/// Pool pause/close is enforced here at the periphery layer via _checkPoolActive() and _checkPoolNotPaused().
/// Any contract inheriting FusangAccessControl must call these checks before interacting with pools.
abstract contract FusangAccessControl {
    /// @notice The Factory contract used to resolve WalletList (single source of truth via AllowList)
    IFusangFactory public immutable factoryContract;

    /// @notice The PoolState contract used for pool active checks
    IFusangPoolState public immutable poolStateContract;

    /// @notice List identifier for whitelisted addresses
    bytes32 public constant WHITELIST = keccak256("WHITELIST");

    /// @notice List identifier for frozen addresses
    bytes32 public constant FROZENLIST = keccak256("FROZENLIST");

    /// @notice List identifier for blacklisted addresses
    bytes32 public constant BLACKLIST = keccak256("BLACKLIST");

    /// @notice Error thrown when caller is not an admin
    error NotAdmin(address account);

    /// @notice Error thrown when an address is not allowed
    error NotAllowedToSwap(address account);

    /// @notice Error thrown when pool is not active (paused or closed)
    error PoolNotActive(address pool);

    /// @notice Error thrown when pool is paused
    error PoolIsPaused(address pool);

    /// @notice Modifier to check if the caller can interact
    modifier onlyAllowed() {
        if (!canSwap(msg.sender)) {
            revert NotAllowedToSwap(msg.sender);
        }
        _;
    }

    constructor(
        address _factory,
        address _poolStateContract
    ) {
        factoryContract = IFusangFactory(_factory);
        poolStateContract = IFusangPoolState(_poolStateContract);
    }

    /// @notice Returns the current WalletList contract (resolved via Factory → AllowList)
    function _walletList() internal view returns (IWalletList) {
        return IWalletList(factoryContract.walletList());
    }

    /// @notice Checks if an address can interact
    /// @param account The address to check
    /// @return bool True if the address can interact
    function canSwap(address account) public view returns (bool) {
        IWalletList wl = _walletList();
        return wl.isAddressInList(WHITELIST, account)
            && !wl.isAddressInList(FROZENLIST, account)
            && !wl.isAddressInList(BLACKLIST, account);
    }

    /// @notice Checks if recipient is allowed to receive tokens
    /// @param recipient The recipient address to check
    function _checkRecipientAllowed(address recipient) internal view {
        if (recipient != address(this) && !canSwap(recipient)) {
            revert NotAllowedToSwap(recipient);
        }
    }

    /// @notice Checks if a pool is active (not paused and not closed)
    /// @param pool The pool address to check
    function _checkPoolActive(address pool) internal view {
        if (!poolStateContract.isPoolActive(pool)) {
            revert PoolNotActive(pool);
        }
    }

    /// @notice Checks if a pool is not paused (allows closed pools)
    /// @param pool The pool address to check
    function _checkPoolNotPaused(address pool) internal view {
        if (poolStateContract.isPoolPaused(pool)) {
            revert PoolIsPaused(pool);
        }
    }
}
