// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2025-12-16:
//   - Upgraded Solidity pragma from =0.7.6 to ^0.8.9
//   - Restructured imports to named imports
pragma solidity ^0.8.9;

import {SwapMath} from '../libraries/SwapMath.sol';

contract SwapMathTest {
    function computeSwapStep(
        uint160 sqrtP,
        uint160 sqrtPTarget,
        uint128 liquidity,
        int256 amountRemaining,
        uint24 feePips
    )
        external
        pure
        returns (
            uint160 sqrtQ,
            uint256 amountIn,
            uint256 amountOut,
            uint256 feeAmount
        )
    {
        return SwapMath.computeSwapStep(sqrtP, sqrtPTarget, liquidity, amountRemaining, feePips);
    }

    function getGasCostOfComputeSwapStep(
        uint160 sqrtP,
        uint160 sqrtPTarget,
        uint128 liquidity,
        int256 amountRemaining,
        uint24 feePips
    ) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        SwapMath.computeSwapStep(sqrtP, sqrtPTarget, liquidity, amountRemaining, feePips);
        return gasBefore - gasleft();
    }
}
