// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2025-12-16:
//   - Upgraded Solidity pragma from =0.7.6 to ^0.8.9
//   - Restructured imports to named imports
pragma solidity ^0.8.9;

import {Tick} from '../libraries/Tick.sol';
import {TickMath} from '../libraries/TickMath.sol';

contract TickEchidnaTest {
    function checkTickSpacingToParametersInvariants(int24 tickSpacing) external pure {
        require(tickSpacing <= TickMath.MAX_TICK);
        require(tickSpacing > 0);

        int24 minTick = (TickMath.MIN_TICK / tickSpacing) * tickSpacing;
        int24 maxTick = (TickMath.MAX_TICK / tickSpacing) * tickSpacing;

        uint128 maxLiquidityPerTick = Tick.tickSpacingToMaxLiquidityPerTick(tickSpacing);

        // symmetry around 0 tick
        assert(maxTick == -minTick);
        // positive max tick
        assert(maxTick > 0);
        // divisibility
        assert((maxTick - minTick) % tickSpacing == 0);

        uint256 numTicks = uint256(int256((maxTick - minTick) / tickSpacing)) + 1;
        // max liquidity at every tick is less than the cap
        assert(uint256(maxLiquidityPerTick) * numTicks <= type(uint128).max);
    }
}
