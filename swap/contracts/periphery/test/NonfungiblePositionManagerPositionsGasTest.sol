// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2025-12-16:
//   - Upgraded Solidity pragma from >=0.7.6 to ^0.8.9
pragma solidity ^0.8.9;

import '../interfaces/INonfungiblePositionManager.sol';

contract NonfungiblePositionManagerPositionsGasTest {
    INonfungiblePositionManager immutable nonfungiblePositionManager;

    constructor(INonfungiblePositionManager _nonfungiblePositionManager) {
        nonfungiblePositionManager = _nonfungiblePositionManager;
    }

    function getGasCostOfPositions(uint256 tokenId) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        nonfungiblePositionManager.positions(tokenId);
        return gasBefore - gasleft();
    }
}
