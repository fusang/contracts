// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2025-12-16:
//   - Upgraded Solidity pragma from =0.7.6 to ^0.8.9
//   - Restructured imports to named imports
pragma solidity ^0.8.9;

import {FullMath} from '../libraries/FullMath.sol';

contract FullMathTest {
    function mulDiv(
        uint256 x,
        uint256 y,
        uint256 z
    ) external pure returns (uint256) {
        return FullMath.mulDiv(x, y, z);
    }

    function mulDivRoundingUp(
        uint256 x,
        uint256 y,
        uint256 z
    ) external pure returns (uint256) {
        return FullMath.mulDivRoundingUp(x, y, z);
    }
}
