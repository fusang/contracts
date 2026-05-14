// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;
pragma abicoder v2;

import './core/libraries/SafeCast.sol';
import './core/libraries/TickMath.sol';
import './core/interfaces/IUniswapV3Pool.sol';

import './periphery/interfaces/ISwapRouter.sol';
import './periphery/base/PeripheryImmutableState.sol';
import './periphery/base/PeripheryValidation.sol';
import './periphery/base/PeripheryPaymentsWithFee.sol';
import './periphery/base/Multicall.sol';
import './periphery/base/SelfPermit.sol';
import './periphery/libraries/Path.sol';
import './periphery/libraries/PoolAddress.sol';
import './periphery/libraries/CallbackValidation.sol';
import './periphery/libraries/TransferHelper.sol';
import './base/FusangAccessControl.sol';

/// @title Fusang Swap Router
/// @author Fusang — Modified 2026-03-06
/// @notice Router for stateless execution of swaps against Uniswap V3 with whitelist access control
/// @dev Extends standard Uniswap V3 SwapRouter with whitelist/blacklist/frozenlist checks
contract FusangSwapRouter is
    ISwapRouter,
    PeripheryImmutableState,
    PeripheryValidation,
    PeripheryPaymentsWithFee,
    Multicall,
    SelfPermit,
    FusangAccessControl
{
    using Path for bytes;
    using SafeCast for uint256;

    /// @dev Used as the placeholder value for amountInCached
    uint256 private constant DEFAULT_AMOUNT_IN_CACHED = type(uint256).max;

    /// @dev Transient storage variable used for returning the computed amount in for an exact output swap
    uint256 private amountInCached = DEFAULT_AMOUNT_IN_CACHED;

    constructor(
        address _factory,
        address _WETH9,
        address _poolStateContract
    )
        PeripheryImmutableState(_factory, _WETH9)
        FusangAccessControl(_factory, _poolStateContract)
    {}

    /// @dev Returns the pool for the given token pair and fee
    function getPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) private view returns (IUniswapV3Pool) {
        return IUniswapV3Pool(PoolAddress.computeAddress(factory, PoolAddress.getPoolKey(tokenA, tokenB, fee)));
    }

    struct SwapCallbackData {
        bytes path;
        address payer;
    }

    /// @inheritdoc IUniswapV3SwapCallback
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata _data
    ) external override {
        require(amount0Delta > 0 || amount1Delta > 0);
        SwapCallbackData memory data = abi.decode(_data, (SwapCallbackData));
        (address tokenIn, address tokenOut, uint24 fee) = data.path.decodeFirstPool();
        CallbackValidation.verifyCallback(factory, tokenIn, tokenOut, fee);

        (bool isExactInput, uint256 amountToPay) = amount0Delta > 0
            ? (tokenIn < tokenOut, uint256(amount0Delta))
            : (tokenOut < tokenIn, uint256(amount1Delta));
        if (isExactInput) {
            pay(tokenIn, data.payer, msg.sender, amountToPay);
        } else {
            if (data.path.hasMultiplePools()) {
                data.path = data.path.skipToken();
                exactOutputInternal(amountToPay, msg.sender, 0, data);
            } else {
                amountInCached = amountToPay;
                tokenIn = tokenOut;
                pay(tokenIn, data.payer, msg.sender, amountToPay);
            }
        }
    }

    /// @dev Performs a single exact input swap
    function exactInputInternal(
        uint256 amountIn,
        address recipient,
        uint160 sqrtPriceLimitX96,
        SwapCallbackData memory data
    ) private returns (uint256 amountOut) {
        if (recipient == address(0)) recipient = address(this);

        (address tokenIn, address tokenOut, uint24 fee) = data.path.decodeFirstPool();

        bool zeroForOne = tokenIn < tokenOut;

        (int256 amount0, int256 amount1) = getPool(tokenIn, tokenOut, fee).swap(
            recipient,
            zeroForOne,
            amountIn.toInt256(),
            sqrtPriceLimitX96 == 0
                ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                : sqrtPriceLimitX96,
            abi.encode(data)
        );

        return uint256(-(zeroForOne ? amount1 : amount0));
    }

    /// @inheritdoc ISwapRouter
    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        onlyAllowed
        checkDeadline(params.deadline)
        returns (uint256 amountOut)
    {
        _checkRecipientAllowed(params.recipient);
        _checkPoolActive(address(getPool(params.tokenIn, params.tokenOut, params.fee)));

        amountOut = exactInputInternal(
            params.amountIn,
            params.recipient,
            params.sqrtPriceLimitX96,
            SwapCallbackData({path: abi.encodePacked(params.tokenIn, params.fee, params.tokenOut), payer: msg.sender})
        );
        require(amountOut >= params.amountOutMinimum, 'Too little received');
    }

    /// @inheritdoc ISwapRouter
    function exactInput(ExactInputParams memory params)
        external
        payable
        override
        onlyAllowed
        checkDeadline(params.deadline)
        returns (uint256 amountOut)
    {
        _checkRecipientAllowed(params.recipient);
        address payer = msg.sender;

        while (true) {
            bool hasMultiplePools = params.path.hasMultiplePools();

            // Check pool is active before swap
            (address tokenIn, address tokenOut, uint24 fee) = params.path.decodeFirstPool();
            _checkPoolActive(address(getPool(tokenIn, tokenOut, fee)));

            params.amountIn = exactInputInternal(
                params.amountIn,
                hasMultiplePools ? address(this) : params.recipient,
                0,
                SwapCallbackData({
                    path: params.path.getFirstPool(),
                    payer: payer
                })
            );

            if (hasMultiplePools) {
                payer = address(this);
                params.path = params.path.skipToken();
            } else {
                amountOut = params.amountIn;
                break;
            }
        }

        require(amountOut >= params.amountOutMinimum, 'Too little received');
    }

    /// @dev Performs a single exact output swap
    function exactOutputInternal(
        uint256 amountOut,
        address recipient,
        uint160 sqrtPriceLimitX96,
        SwapCallbackData memory data
    ) private returns (uint256 amountIn) {
        if (recipient == address(0)) recipient = address(this);

        (address tokenOut, address tokenIn, uint24 fee) = data.path.decodeFirstPool();

        bool zeroForOne = tokenIn < tokenOut;

        (int256 amount0Delta, int256 amount1Delta) = getPool(tokenIn, tokenOut, fee).swap(
            recipient,
            zeroForOne,
            -amountOut.toInt256(),
            sqrtPriceLimitX96 == 0
                ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                : sqrtPriceLimitX96,
            abi.encode(data)
        );

        uint256 amountOutReceived;
        (amountIn, amountOutReceived) = zeroForOne
            ? (uint256(amount0Delta), uint256(-amount1Delta))
            : (uint256(amount1Delta), uint256(-amount0Delta));
        if (sqrtPriceLimitX96 == 0) require(amountOutReceived == amountOut);
    }

    /// @inheritdoc ISwapRouter
    function exactOutputSingle(ExactOutputSingleParams calldata params)
        external
        payable
        override
        onlyAllowed
        checkDeadline(params.deadline)
        returns (uint256 amountIn)
    {
        _checkRecipientAllowed(params.recipient);
        _checkPoolActive(address(getPool(params.tokenIn, params.tokenOut, params.fee)));

        amountIn = exactOutputInternal(
            params.amountOut,
            params.recipient,
            params.sqrtPriceLimitX96,
            SwapCallbackData({path: abi.encodePacked(params.tokenOut, params.fee, params.tokenIn), payer: msg.sender})
        );

        require(amountIn <= params.amountInMaximum, 'Too much requested');
        amountInCached = DEFAULT_AMOUNT_IN_CACHED;
    }

    /// @inheritdoc ISwapRouter
    function exactOutput(ExactOutputParams calldata params)
        external
        payable
        override
        onlyAllowed
        checkDeadline(params.deadline)
        returns (uint256 amountIn)
    {
        _checkRecipientAllowed(params.recipient);
        // Check all pools in path are active (path is reversed: tokenOut, fee, tokenIn)
        bytes memory path = params.path;
        while (true) {
            (address tokenOut, address tokenIn, uint24 fee) = path.decodeFirstPool();
            _checkPoolActive(address(getPool(tokenIn, tokenOut, fee)));

            if (path.hasMultiplePools()) {
                path = path.skipToken();
            } else {
                break;
            }
        }

        exactOutputInternal(
            params.amountOut,
            params.recipient,
            0,
            SwapCallbackData({path: params.path, payer: msg.sender})
        );

        amountIn = amountInCached;
        require(amountIn <= params.amountInMaximum, 'Too much requested');
        amountInCached = DEFAULT_AMOUNT_IN_CACHED;
    }

    // ============ Restricted Sweep/Refund Overrides (V-001 fix) ============

    /// @dev Override to restrict sweepToken to whitelisted callers and recipients
    function sweepToken(
        address token,
        uint256 amountMinimum,
        address recipient
    ) public payable override(IPeripheryPayments, PeripheryPayments) onlyAllowed {
        _checkRecipientAllowed(recipient);
        super.sweepToken(token, amountMinimum, recipient);
    }

    /// @dev Override to restrict unwrapWETH9 to whitelisted callers and recipients
    function unwrapWETH9(uint256 amountMinimum, address recipient) public payable override(IPeripheryPayments, PeripheryPayments) onlyAllowed {
        _checkRecipientAllowed(recipient);
        super.unwrapWETH9(amountMinimum, recipient);
    }

    /// @dev Override to restrict refundETH to whitelisted callers
    function refundETH() external payable override(IPeripheryPayments, PeripheryPayments) onlyAllowed {
        if (address(this).balance > 0) TransferHelper.safeTransferETH(msg.sender, address(this).balance);
    }

    /// @dev Override to restrict sweepTokenWithFee to whitelisted callers and recipients
    function sweepTokenWithFee(
        address token,
        uint256 amountMinimum,
        address recipient,
        uint256 feeBips,
        address feeRecipient
    ) public payable override(PeripheryPaymentsWithFee) onlyAllowed {
        _checkRecipientAllowed(recipient);
        _checkRecipientAllowed(feeRecipient);
        super.sweepTokenWithFee(token, amountMinimum, recipient, feeBips, feeRecipient);
    }

    /// @dev Override to restrict unwrapWETH9WithFee to whitelisted callers and recipients
    function unwrapWETH9WithFee(
        uint256 amountMinimum,
        address recipient,
        uint256 feeBips,
        address feeRecipient
    ) public payable override(PeripheryPaymentsWithFee) onlyAllowed {
        _checkRecipientAllowed(recipient);
        _checkRecipientAllowed(feeRecipient);
        super.unwrapWETH9WithFee(amountMinimum, recipient, feeBips, feeRecipient);
    }
}
