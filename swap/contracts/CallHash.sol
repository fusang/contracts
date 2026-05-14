// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import './core/UniswapV3Pool.sol';

contract CallHash{
    function getInitHash() public pure returns(bytes32) {
        bytes memory bytecode = type(UniswapV3Pool).creationCode;
        return keccak256(abi.encodePacked(bytecode));
    }
}