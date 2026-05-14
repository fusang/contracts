// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2025-12-16:
//   - Upgraded Solidity pragma from =0.7.6 to ^0.8.9
//   - Restructured imports to named imports
pragma solidity ^0.8.9;

import {TickBitmap} from '../libraries/TickBitmap.sol';

contract TickBitmapTest {
    using TickBitmap for mapping(int16 => uint256);

    mapping(int16 => uint256) public bitmap;

    function flipTick(int24 tick) external {
        bitmap.flipTick(tick, 1);
    }

    function getGasCostOfFlipTick(int24 tick) external returns (uint256) {
        uint256 gasBefore = gasleft();
        bitmap.flipTick(tick, 1);
        return gasBefore - gasleft();
    }

    function nextInitializedTickWithinOneWord(int24 tick, bool lte)
        external
        view
        returns (int24 next, bool initialized)
    {
        return bitmap.nextInitializedTickWithinOneWord(tick, 1, lte);
    }

    function getGasCostOfNextInitializedTickWithinOneWord(int24 tick, bool lte) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        bitmap.nextInitializedTickWithinOneWord(tick, 1, lte);
        return gasBefore - gasleft();
    }

    // returns whether the given tick is initialized
    function isInitialized(int24 tick) external view returns (bool) {
        (int24 next, bool initialized) = bitmap.nextInitializedTickWithinOneWord(tick, 1, true);
        return next == tick ? initialized : false;
    }
}
