// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2025-12-16:
//   - Upgraded Solidity pragma from >=0.7.6 to ^0.8.9
pragma solidity ^0.8.9;

import '@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol';

contract TestERC20Metadata is ERC20Permit {
    constructor(
        uint256 amountToMint,
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) ERC20Permit(name) {
        _mint(msg.sender, amountToMint);
    }
}
