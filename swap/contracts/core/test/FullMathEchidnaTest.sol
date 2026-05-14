// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2025-12-16:
//   - Upgraded Solidity pragma from =0.7.6 to ^0.8.9
//   - Restructured imports to named imports
pragma solidity ^0.8.9;

import {FullMath} from '../libraries/FullMath.sol';

contract FullMathEchidnaTest {
    function checkMulDivRounding(
        uint256 x,
        uint256 y,
        uint256 d
    ) external pure {
        unchecked {
            require(d > 0);

            uint256 ceiled = FullMath.mulDivRoundingUp(x, y, d);
            uint256 floored = FullMath.mulDiv(x, y, d);

            if (mulmod(x, y, d) > 0) {
                assert(ceiled - floored == 1);
            } else {
                assert(ceiled == floored);
            }
        }
    }

    function checkMulDiv(
        uint256 x,
        uint256 y,
        uint256 d
    ) external pure {
        unchecked {
            require(d > 0);
            uint256 z = FullMath.mulDiv(x, y, d);
            if (x == 0 || y == 0) {
                assert(z == 0);
                return;
            }

            // recompute x and y via mulDiv of the result of floor(x*y/d), should always be less than original inputs by < d
            uint256 x2 = FullMath.mulDiv(z, d, y);
            uint256 y2 = FullMath.mulDiv(z, d, x);
            assert(x2 <= x);
            assert(y2 <= y);

            assert(x - x2 < d);
            assert(y - y2 < d);
        }
    }

    function checkMulDivRoundingUp(
        uint256 x,
        uint256 y,
        uint256 d
    ) external pure {
        unchecked {
            require(d > 0);
            uint256 z = FullMath.mulDivRoundingUp(x, y, d);
            if (x == 0 || y == 0) {
                assert(z == 0);
                return;
            }

            // recompute x and y via mulDiv of the result of floor(x*y/d), should always be less than original inputs by < d
            uint256 x2 = FullMath.mulDiv(z, d, y);
            uint256 y2 = FullMath.mulDiv(z, d, x);
            assert(x2 >= x);
            assert(y2 >= y);

            assert(x2 - x < d);
            assert(y2 - y < d);
        }
    }
}
