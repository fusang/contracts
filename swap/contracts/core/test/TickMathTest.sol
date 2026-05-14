// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2025-12-16:
//   - Upgraded Solidity pragma from =0.7.6 to ^0.8.9
//   - Restructured imports to named imports
pragma solidity ^0.8.9;

import {TickMath} from '../libraries/TickMath.sol';

contract TickMathTest {
    function getSqrtRatioAtTick(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }

    function getGasCostOfGetSqrtRatioAtTick(int24 tick) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        TickMath.getSqrtRatioAtTick(tick);
        return gasBefore - gasleft();
    }

    function getTickAtSqrtRatio(uint160 sqrtPriceX96) external pure returns (int24) {
        return TickMath.getTickAtSqrtRatio(sqrtPriceX96);
    }

    function getGasCostOfGetTickAtSqrtRatio(uint160 sqrtPriceX96) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        TickMath.getTickAtSqrtRatio(sqrtPriceX96);
        return gasBefore - gasleft();
    }

    function MIN_SQRT_RATIO() external pure returns (uint160) {
        return TickMath.MIN_SQRT_RATIO;
    }

    function MAX_SQRT_RATIO() external pure returns (uint160) {
        return TickMath.MAX_SQRT_RATIO;
    }
}
