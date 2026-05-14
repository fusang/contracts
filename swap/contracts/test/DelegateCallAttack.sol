// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

contract DelegateCallAttack {
    address public target;

    constructor(address _target) {
        target = _target;
    }

    function attack(address tokenA, address tokenB, uint24 fee) external {
        (bool success, ) = target.delegatecall(
            abi.encodeWithSignature("createPool(address,address,uint24)", tokenA, tokenB, fee)
        );
        require(success, "Delegatecall failed");
    }
}