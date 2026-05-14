// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2025-12-16:
//   - Upgraded Solidity pragma from >=0.7.6 to ^0.8.9
pragma solidity ^0.8.9;
pragma abicoder v2;

import '../NonfungiblePositionManager.sol';

contract MockTimeNonfungiblePositionManager is NonfungiblePositionManager {
    uint256 time;

    constructor(
        address _factory,
        address _WETH9,
        address _tokenDescriptor
    ) NonfungiblePositionManager(_factory, _WETH9, _tokenDescriptor) {}

    function _blockTimestamp() internal view override returns (uint256) {
        return time;
    }

    function setTime(uint256 _time) external {
        time = _time;
    }
}
