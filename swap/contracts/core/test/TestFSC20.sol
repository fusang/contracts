// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '../../interfaces/IWalletList.sol';

/**
 * @title TestFSC20
 * @notice A test ERC20 token with whitelist support via WalletList
 * @dev Simplified version of FSC20 for testing purposes
 */
contract TestFSC20 is ERC20, Ownable {
    IWalletList public immutable walletListContract;

    bytes32 public constant WHITELIST = keccak256('WHITELIST');
    bytes32 public constant BLACKLIST = keccak256('BLACKLIST');
    bytes32 public constant FROZENLIST = keccak256('FROZENLIST');

    error NotWhitelisted(address account);

    constructor(
        string memory name_,
        string memory symbol_,
        IWalletList walletListContract_
    ) ERC20(name_, symbol_) {
        walletListContract = walletListContract_;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function canTransfer(address account) public view returns (bool) {
        return walletListContract.isAddressInList(WHITELIST, account)
            && !walletListContract.isAddressInList(FROZENLIST, account)
            && !walletListContract.isAddressInList(BLACKLIST, account);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);

        // Skip checks for minting (from == 0) and burning (to == 0)
        if (from != address(0) && !canTransfer(from)) {
            revert NotWhitelisted(from);
        }
        if (to != address(0) && !canTransfer(to)) {
            revert NotWhitelisted(to);
        }
    }
}
