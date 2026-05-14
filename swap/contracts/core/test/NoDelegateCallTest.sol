// SPDX-License-Identifier: GPL-2.0-or-later
// Modified by Fusang Technology Limited on 2025-12-16:
//   - Upgraded Solidity pragma from =0.7.6 to ^0.8.9
//   - Restructured imports to named imports
pragma solidity ^0.8.9;

import {NoDelegateCall} from '../NoDelegateCall.sol';

contract NoDelegateCallTest is NoDelegateCall {
    function canBeDelegateCalled() public view returns (uint256) {
        return block.timestamp / 5;
    }

    function cannotBeDelegateCalled() public view noDelegateCall returns (uint256) {
        return block.timestamp / 5;
    }

    function getGasCostOfCanBeDelegateCalled() external view returns (uint256) {
        uint256 gasBefore = gasleft();
        canBeDelegateCalled();
        return gasBefore - gasleft();
    }

    function getGasCostOfCannotBeDelegateCalled() external view returns (uint256) {
        uint256 gasBefore = gasleft();
        cannotBeDelegateCalled();
        return gasBefore - gasleft();
    }

    function callsIntoNoDelegateCallFunction() external {
        noDelegateCallPrivate();
    }

    function noDelegateCallPrivate() private noDelegateCall {}
}
