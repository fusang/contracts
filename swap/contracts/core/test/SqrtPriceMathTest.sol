// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2025-12-16:
//   - Upgraded Solidity pragma from =0.7.6 to ^0.8.9
//   - Restructured imports to named imports
pragma solidity ^0.8.9;

import {SqrtPriceMath} from '../libraries/SqrtPriceMath.sol';

contract SqrtPriceMathTest {
    function getNextSqrtPriceFromInput(
        uint160 sqrtP,
        uint128 liquidity,
        uint256 amountIn,
        bool zeroForOne
    ) external pure returns (uint160 sqrtQ) {
        return SqrtPriceMath.getNextSqrtPriceFromInput(sqrtP, liquidity, amountIn, zeroForOne);
    }

    function getGasCostOfGetNextSqrtPriceFromInput(
        uint160 sqrtP,
        uint128 liquidity,
        uint256 amountIn,
        bool zeroForOne
    ) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        SqrtPriceMath.getNextSqrtPriceFromInput(sqrtP, liquidity, amountIn, zeroForOne);
        return gasBefore - gasleft();
    }

    function getNextSqrtPriceFromOutput(
        uint160 sqrtP,
        uint128 liquidity,
        uint256 amountOut,
        bool zeroForOne
    ) external pure returns (uint160 sqrtQ) {
        return SqrtPriceMath.getNextSqrtPriceFromOutput(sqrtP, liquidity, amountOut, zeroForOne);
    }

    function getGasCostOfGetNextSqrtPriceFromOutput(
        uint160 sqrtP,
        uint128 liquidity,
        uint256 amountOut,
        bool zeroForOne
    ) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        SqrtPriceMath.getNextSqrtPriceFromOutput(sqrtP, liquidity, amountOut, zeroForOne);
        return gasBefore - gasleft();
    }

    function getAmount0Delta(
        uint160 sqrtLower,
        uint160 sqrtUpper,
        uint128 liquidity,
        bool roundUp
    ) external pure returns (uint256 amount0) {
        return SqrtPriceMath.getAmount0Delta(sqrtLower, sqrtUpper, liquidity, roundUp);
    }

    function getAmount1Delta(
        uint160 sqrtLower,
        uint160 sqrtUpper,
        uint128 liquidity,
        bool roundUp
    ) external pure returns (uint256 amount1) {
        return SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtUpper, liquidity, roundUp);
    }

    function getGasCostOfGetAmount0Delta(
        uint160 sqrtLower,
        uint160 sqrtUpper,
        uint128 liquidity,
        bool roundUp
    ) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        SqrtPriceMath.getAmount0Delta(sqrtLower, sqrtUpper, liquidity, roundUp);
        return gasBefore - gasleft();
    }

    function getGasCostOfGetAmount1Delta(
        uint160 sqrtLower,
        uint160 sqrtUpper,
        uint128 liquidity,
        bool roundUp
    ) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtUpper, liquidity, roundUp);
        return gasBefore - gasleft();
    }
}
