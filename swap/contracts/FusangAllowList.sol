// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import "./interfaces/IFusangAllowList.sol";
import "./interfaces/IWalletList.sol";

/// @title Fusang AllowList
/// @author Fusang
/// @notice Minimal allowlist for UniswapV3Pool write function access control
/// @dev Delegates admin role checks to WalletList contract
/// @dev SECURITY BOUNDARY: Pool pause/close is enforced at the periphery layer (PositionManager, SwapRouter),
/// not at the core pool level. The AllowList restricts which contracts can interact with pools. Operators must
/// ensure that all allowlisted contracts enforce _checkPoolActive() before calling pool functions. Adding a
/// contract to the AllowList without pause enforcement effectively bypasses the pause mechanism for that
/// contract's users.
contract FusangAllowList is IFusangAllowList {
    /// @notice The WalletList contract for admin role management
    address public walletList;

    mapping(address => bool) public allowed;

    event AllowedChanged(address indexed account, bool allowed);
    event WalletListChanged(address indexed oldWalletList, address indexed newWalletList);

    error NotAdmin(address account);

    modifier onlyAdmin() {
        if (!isAdmin(msg.sender)) revert NotAdmin(msg.sender);
        _;
    }

    constructor(address _walletList) {
        walletList = _walletList;
    }

    function isAllowed(address account) external view override returns (bool) {
        return allowed[account];
    }

    function setAllowed(address account, bool _allowed) external override onlyAdmin {
        allowed[account] = _allowed;
        emit AllowedChanged(account, _allowed);
    }

    /// @notice Batch set allowed status for multiple accounts
    /// @param accounts The accounts to set
    /// @param _allowed The allowed status to set
    function batchSetAllowed(address[] calldata accounts, bool _allowed) external onlyAdmin {
        for (uint256 i = 0; i < accounts.length; i++) {
            allowed[accounts[i]] = _allowed;
            emit AllowedChanged(accounts[i], _allowed);
        }
    }

    /// @notice Updates the WalletList contract address
    /// @param _walletList The new WalletList contract address
    function setWalletList(address _walletList) external onlyAdmin {
        require(_walletList != address(0));
        address oldWalletList = walletList;
        walletList = _walletList;
        emit WalletListChanged(oldWalletList, _walletList);
    }

    /// @notice Check if an account has admin role
    /// @param account The account to check
    /// @return True if the account is an admin in WalletList
    function isAdmin(address account) public view returns (bool) {
        return IWalletList(walletList).isAdmin(account);
    }
}
