// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2025-12-16:
//   - Upgraded Solidity pragma from =0.7.6 to ^0.8.9
//   - Restructured imports to named imports
pragma solidity ^0.8.9;

import {BitMath} from '../libraries/BitMath.sol';

contract BitMathEchidnaTest {
    function mostSignificantBitInvariant(uint256 input) external pure {
        unchecked {
            uint8 msb = BitMath.mostSignificantBit(input);
            assert(input >= (uint256(2)**msb));
            assert(msb == 255 || input < uint256(2)**(msb + 1));
        }
    }

    function leastSignificantBitInvariant(uint256 input) external pure {
        unchecked {
            uint8 lsb = BitMath.leastSignificantBit(input);
            assert(input & (uint256(2)**lsb) != 0);
            assert(input & (uint256(2)**lsb - 1) == 0);
        }
    }
}
