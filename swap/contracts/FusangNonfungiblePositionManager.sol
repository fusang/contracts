// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;
pragma abicoder v2;

import "./core/interfaces/IUniswapV3Pool.sol";
import "./core/libraries/FixedPoint128.sol";
import "./core/libraries/FullMath.sol";

import "./interfaces/IFusangNonfungiblePositionManager.sol";
import "./interfaces/IFusangFactory.sol";
import "./periphery/interfaces/INonfungibleTokenPositionDescriptor.sol";
import "./periphery/libraries/PositionKey.sol";
import "./periphery/libraries/PoolAddress.sol";
import "./periphery/base/LiquidityManagement.sol";
import "./periphery/base/PeripheryImmutableState.sol";
import "./periphery/base/Multicall.sol";
import "./periphery/base/ERC721Permit.sol";
import "./periphery/base/PeripheryValidation.sol";
import "./periphery/base/SelfPermit.sol";
import "./periphery/base/PoolInitializer.sol";
import "./periphery/libraries/TransferHelper.sol";
import "./base/FusangAccessControl.sol";

/// @title Fusang NFT Positions
/// @author Fusang — Modified 2026-03-06
/// @notice Wraps Uniswap V3 positions in the ERC721 non-fungible token interface with access control
/// @dev Extends standard NonfungiblePositionManager with whitelist/blacklist/frozenlist checks
contract FusangNonfungiblePositionManager is
    IFusangNonfungiblePositionManager,
    Multicall,
    ERC721Permit,
    PeripheryImmutableState,
    PoolInitializer,
    LiquidityManagement,
    PeripheryValidation,
    SelfPermit,
    FusangAccessControl
{
    // details about the uniswap position
    struct Position {
        // the nonce for permits
        uint96 nonce;
        // the address that is approved for spending this token
        address operator;
        // the ID of the pool with which this token is connected
        uint80 poolId;
        // the tick range of the position
        int24 tickLower;
        int24 tickUpper;
        // the liquidity of the position
        uint128 liquidity;
        // the fee growth of the aggregate position as of the last action on the individual position
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        // how many uncollected tokens are owed to the position, as of the last computation
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    /// @dev IDs of pools assigned by this contract
    mapping(address => uint80) private _poolIds;

    /// @dev Pool keys by pool ID, to save on SSTOREs for position data
    mapping(uint80 => PoolAddress.PoolKey) private _poolIdToPoolKey;

    /// @dev The token ID position data
    mapping(uint256 => Position) private _positions;

    /// @dev The ID of the next token that will be minted. Skips 0
    uint176 private _nextId = 1;
    /// @dev The ID of the next pool that is used for the first time. Skips 0
    uint80 private _nextPoolId = 1;

    /// @dev The address of the token descriptor contract, which handles generating token URIs for position tokens
    address private immutable _tokenDescriptor;

    constructor(
        address _factory,
        address _WETH9,
        address _tokenDescriptor_,
        address _poolStateContract
    )
        ERC721Permit("Fusang V3 Positions NFT-V1", "FUSANG-V3-POS", "1")
        PeripheryImmutableState(_factory, _WETH9)
        FusangAccessControl(_factory, _poolStateContract)
    {
        _tokenDescriptor = _tokenDescriptor_;
    }

    /// @notice Initializes an existing pool if not yet initialized
    /// @dev Only admins can call. Pool must already be created via Factory.createPool()
    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable override(IPoolInitializer, PoolInitializer) returns (address pool) {
        if (!IFusangFactory(factory).isAdmin(msg.sender)) {
            revert NotAdmin(msg.sender);
        }
        require(token0 < token1);
        pool = IUniswapV3Factory(factory).getPool(token0, token1, fee);
        require(pool != address(0), "Pool not created");

        (uint160 sqrtPriceX96Existing, , , , , , ) = IUniswapV3Pool(pool).slot0();
        if (sqrtPriceX96Existing == 0) {
            IUniswapV3Pool(pool).initialize(sqrtPriceX96);
        }
    }

    /// @inheritdoc INonfungiblePositionManager
    function positions(
        uint256 tokenId
    )
        external
        view
        override
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        Position memory position = _positions[tokenId];
        require(position.poolId != 0, "Invalid token ID");
        PoolAddress.PoolKey memory poolKey = _poolIdToPoolKey[position.poolId];
        return (
            position.nonce,
            position.operator,
            poolKey.token0,
            poolKey.token1,
            poolKey.fee,
            position.tickLower,
            position.tickUpper,
            position.liquidity,
            position.feeGrowthInside0LastX128,
            position.feeGrowthInside1LastX128,
            position.tokensOwed0,
            position.tokensOwed1
        );
    }

    /// @dev Caches a pool key
    function cachePoolKey(
        address pool,
        PoolAddress.PoolKey memory poolKey
    ) private returns (uint80 poolId) {
        poolId = _poolIds[pool];
        if (poolId == 0) {
            _poolIds[pool] = (poolId = _nextPoolId++);
            _poolIdToPoolKey[poolId] = poolKey;
        }
    }

    /// @inheritdoc INonfungiblePositionManager
    function mint(
        MintParams calldata params
    )
        external
        payable
        override
        onlyAllowed
        checkDeadline(params.deadline)
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        _checkRecipientAllowed(params.recipient);

        // Check pool is active
        address pool = PoolAddress.computeAddress(
            factory,
            PoolAddress.PoolKey({token0: params.token0, token1: params.token1, fee: params.fee})
        );
        _checkPoolActive(pool);

        IUniswapV3Pool poolContract;
        (liquidity, amount0, amount1, poolContract) = addLiquidity(
            AddLiquidityParams({
                token0: params.token0,
                token1: params.token1,
                fee: params.fee,
                recipient: address(this),
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,
                amount0Desired: params.amount0Desired,
                amount1Desired: params.amount1Desired,
                amount0Min: params.amount0Min,
                amount1Min: params.amount1Min
            })
        );

        _mint(params.recipient, (tokenId = _nextId++));

        bytes32 positionKey = PositionKey.compute(
            address(this),
            params.tickLower,
            params.tickUpper
        );
        (
            ,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            ,

        ) = poolContract.positions(positionKey);

        // idempotent set
        uint80 poolId = cachePoolKey(
            address(poolContract),
            PoolAddress.PoolKey({
                token0: params.token0,
                token1: params.token1,
                fee: params.fee
            })
        );

        _positions[tokenId] = Position({
            nonce: 0,
            operator: address(0),
            poolId: poolId,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity,
            feeGrowthInside0LastX128: feeGrowthInside0LastX128,
            feeGrowthInside1LastX128: feeGrowthInside1LastX128,
            tokensOwed0: 0,
            tokensOwed1: 0
        });

        emit IncreaseLiquidity(tokenId, liquidity, amount0, amount1);
    }

    modifier isAuthorizedForToken(uint256 tokenId) {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not approved");
        _;
    }

    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, IERC721Metadata) returns (string memory) {
        require(_exists(tokenId));
        return
            INonfungibleTokenPositionDescriptor(_tokenDescriptor).tokenURI(
                this,
                tokenId
            );
    }

    // save bytecode by removing implementation of unused method
    function baseURI() public pure returns (string memory) {}

    /// @inheritdoc INonfungiblePositionManager
    function increaseLiquidity(
        IncreaseLiquidityParams calldata params
    )
        external
        payable
        override
        onlyAllowed
        checkDeadline(params.deadline)
        returns (uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        // Note: Anyone whitelisted can add liquidity to any position (donation mechanism)
        // But we check the position owner is allowed to prevent donations to blacklisted users
        _checkPositionOwnerAllowed(params.tokenId);

        Position storage position = _positions[params.tokenId];

        PoolAddress.PoolKey memory poolKey = _poolIdToPoolKey[position.poolId];

        // Check pool is active
        _checkPoolActive(PoolAddress.computeAddress(factory, poolKey));

        IUniswapV3Pool pool;
        (liquidity, amount0, amount1, pool) = addLiquidity(
            AddLiquidityParams({
                token0: poolKey.token0,
                token1: poolKey.token1,
                fee: poolKey.fee,
                tickLower: position.tickLower,
                tickUpper: position.tickUpper,
                amount0Desired: params.amount0Desired,
                amount1Desired: params.amount1Desired,
                amount0Min: params.amount0Min,
                amount1Min: params.amount1Min,
                recipient: address(this)
            })
        );

        bytes32 positionKey = PositionKey.compute(
            address(this),
            position.tickLower,
            position.tickUpper
        );

        // this is now updated to the current transaction
        (
            ,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            ,

        ) = pool.positions(positionKey);

        position.tokensOwed0 += uint128(
            FullMath.mulDiv(
                feeGrowthInside0LastX128 - position.feeGrowthInside0LastX128,
                position.liquidity,
                FixedPoint128.Q128
            )
        );
        position.tokensOwed1 += uint128(
            FullMath.mulDiv(
                feeGrowthInside1LastX128 - position.feeGrowthInside1LastX128,
                position.liquidity,
                FixedPoint128.Q128
            )
        );

        position.feeGrowthInside0LastX128 = feeGrowthInside0LastX128;
        position.feeGrowthInside1LastX128 = feeGrowthInside1LastX128;
        position.liquidity += liquidity;

        emit IncreaseLiquidity(params.tokenId, liquidity, amount0, amount1);
    }

    /// @inheritdoc INonfungiblePositionManager
    function decreaseLiquidity(
        DecreaseLiquidityParams calldata params
    )
        external
        payable
        override
        onlyAllowed
        isAuthorizedForToken(params.tokenId)
        checkDeadline(params.deadline)
        returns (uint256 amount0, uint256 amount1)
    {
        // Check position owner is also allowed (not blacklisted/frozen)
        _checkPositionOwnerAllowed(params.tokenId);

        require(params.liquidity > 0);
        Position storage position = _positions[params.tokenId];

        uint128 positionLiquidity = position.liquidity;
        require(positionLiquidity >= params.liquidity);

        PoolAddress.PoolKey memory poolKey = _poolIdToPoolKey[position.poolId];

        // Check pool is not paused (allow closed pools)
        _checkPoolNotPaused(PoolAddress.computeAddress(factory, poolKey));

        IUniswapV3Pool pool = IUniswapV3Pool(
            PoolAddress.computeAddress(factory, poolKey)
        );
        (amount0, amount1) = pool.burn(
            position.tickLower,
            position.tickUpper,
            params.liquidity
        );

        require(
            amount0 >= params.amount0Min && amount1 >= params.amount1Min,
            "Price slippage check"
        );

        bytes32 positionKey = PositionKey.compute(
            address(this),
            position.tickLower,
            position.tickUpper
        );
        // this is now updated to the current transaction
        (
            ,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            ,

        ) = pool.positions(positionKey);

        position.tokensOwed0 +=
            uint128(amount0) +
            uint128(
                FullMath.mulDiv(
                    feeGrowthInside0LastX128 -
                        position.feeGrowthInside0LastX128,
                    positionLiquidity,
                    FixedPoint128.Q128
                )
            );
        position.tokensOwed1 +=
            uint128(amount1) +
            uint128(
                FullMath.mulDiv(
                    feeGrowthInside1LastX128 -
                        position.feeGrowthInside1LastX128,
                    positionLiquidity,
                    FixedPoint128.Q128
                )
            );

        position.feeGrowthInside0LastX128 = feeGrowthInside0LastX128;
        position.feeGrowthInside1LastX128 = feeGrowthInside1LastX128;
        // subtraction is safe because we checked positionLiquidity is gte params.liquidity
        position.liquidity = positionLiquidity - params.liquidity;

        emit DecreaseLiquidity(
            params.tokenId,
            params.liquidity,
            amount0,
            amount1
        );
    }

    /// @inheritdoc INonfungiblePositionManager
    function collect(
        CollectParams calldata params
    )
        external
        payable
        override
        onlyAllowed
        isAuthorizedForToken(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        require(params.amount0Max > 0 || params.amount1Max > 0);

        // Check position owner is also allowed (not blacklisted/frozen)
        _checkPositionOwnerAllowed(params.tokenId);

        // Check recipient is allowed
        _checkRecipientAllowed(params.recipient);

        // allow collecting to the nft position manager address with address 0
        address recipient = params.recipient == address(0)
            ? address(this)
            : params.recipient;

        Position storage position = _positions[params.tokenId];

        PoolAddress.PoolKey memory poolKey = _poolIdToPoolKey[position.poolId];

        // Check pool is not paused (allow closed pools)
        _checkPoolNotPaused(PoolAddress.computeAddress(factory, poolKey));

        IUniswapV3Pool pool = IUniswapV3Pool(
            PoolAddress.computeAddress(factory, poolKey)
        );

        (uint128 tokensOwed0, uint128 tokensOwed1) = (
            position.tokensOwed0,
            position.tokensOwed1
        );

        // trigger an update of the position fees owed and fee growth snapshots if it has any liquidity
        if (position.liquidity > 0) {
            pool.burn(position.tickLower, position.tickUpper, 0);
            (
                ,
                uint256 feeGrowthInside0LastX128,
                uint256 feeGrowthInside1LastX128,
                ,

            ) = pool.positions(
                    PositionKey.compute(
                        address(this),
                        position.tickLower,
                        position.tickUpper
                    )
                );

            tokensOwed0 += uint128(
                FullMath.mulDiv(
                    feeGrowthInside0LastX128 -
                        position.feeGrowthInside0LastX128,
                    position.liquidity,
                    FixedPoint128.Q128
                )
            );
            tokensOwed1 += uint128(
                FullMath.mulDiv(
                    feeGrowthInside1LastX128 -
                        position.feeGrowthInside1LastX128,
                    position.liquidity,
                    FixedPoint128.Q128
                )
            );

            position.feeGrowthInside0LastX128 = feeGrowthInside0LastX128;
            position.feeGrowthInside1LastX128 = feeGrowthInside1LastX128;
        }

        // compute the arguments to give to the pool#collect method
        (uint128 amount0Collect, uint128 amount1Collect) = (
            params.amount0Max > tokensOwed0 ? tokensOwed0 : params.amount0Max,
            params.amount1Max > tokensOwed1 ? tokensOwed1 : params.amount1Max
        );

        // the actual amounts collected are returned
        (amount0, amount1) = pool.collect(
            recipient,
            position.tickLower,
            position.tickUpper,
            amount0Collect,
            amount1Collect
        );

        // sometimes there will be a few less wei than expected due to rounding down in core, but we just subtract the full amount expected
        // instead of the actual amount so we can burn the token
        (position.tokensOwed0, position.tokensOwed1) = (
            tokensOwed0 - amount0Collect,
            tokensOwed1 - amount1Collect
        );

        emit Collect(params.tokenId, recipient, amount0Collect, amount1Collect);
    }

    /// @inheritdoc INonfungiblePositionManager
    function burn(
        uint256 tokenId
    ) external payable override onlyAllowed isAuthorizedForToken(tokenId) {
        // Check position owner is also allowed (not blacklisted/frozen)
        _checkPositionOwnerAllowed(tokenId);

        Position storage position = _positions[tokenId];

        // Check pool is not paused (allow closed pools)
        PoolAddress.PoolKey memory poolKey = _poolIdToPoolKey[position.poolId];
        _checkPoolNotPaused(PoolAddress.computeAddress(factory, poolKey));

        require(
            position.liquidity == 0 &&
                position.tokensOwed0 == 0 &&
                position.tokensOwed1 == 0,
            "Not cleared"
        );
        delete _positions[tokenId];
        _burn(tokenId);
    }

    function _getAndIncrementNonce(
        uint256 tokenId
    ) internal override returns (uint256) {
        return uint256(_positions[tokenId].nonce++);
    }

    /// @inheritdoc IERC721
    function getApproved(
        uint256 tokenId
    ) public view override(ERC721, IERC721) returns (address) {
        require(
            _exists(tokenId),
            "ERC721: approved query for nonexistent token"
        );

        return _positions[tokenId].operator;
    }

    /// @dev Checks that an account is admin or can swap, reverts otherwise
    function _checkAllowedOrAdmin(address account) private view {
        if (!IFusangFactory(factory).isAdmin(account) && !canSwap(account)) {
            revert NotAllowedToSwap(account);
        }
    }

    /// @dev Overrides _approve to use the operator in the position, which is packed with the position permit nonce
    /// @dev Rejects non-compliant callers and operators at approval time
    function _approve(address to, uint256 tokenId) internal override(ERC721) {
        _checkAllowedOrAdmin(msg.sender);
        if (to != address(0)) {
            _checkAllowedOrAdmin(to);
        }
        _positions[tokenId].operator = to;
        emit Approval(ownerOf(tokenId), to, tokenId);
    }

    /// @inheritdoc IERC721
    /// @dev Rejects non-compliant callers and operators at approval time
    function setApprovalForAll(address operator, bool approved) public override(ERC721, IERC721) {
        _checkAllowedOrAdmin(msg.sender);  
        if (approved) {
            _checkAllowedOrAdmin(operator);
        }
        super.setApprovalForAll(operator, approved);
    }

    /// @inheritdoc IERC721
    /// @dev Override to auto-approve factory admins for all tokens
    function isApprovedForAll(
        address owner,
        address operator
    ) public view override(ERC721, IERC721) returns (bool) {
        // Factory admin is automatically approved for all tokens
        if (IFusangFactory(factory).isAdmin(operator)) {
            return true;
        }
        return super.isApprovedForAll(owner, operator);
    }

    /// @dev Override to add whitelist/blacklist checks on transfers
    /// @param from The address transferring the token
    /// @param to The address receiving the token
    /// @param tokenId The token being transferred
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal override(ERC721Enumerable) {
        // Skip checks for minting (from = 0) and burning (to = 0)
        // Those are already protected by onlyAllowed modifier
        if (from != address(0) && to != address(0)) {
            // Admin can force transfer without checks
            if (!IFusangFactory(factory).isAdmin(msg.sender)) {
                // For normal transfers, check both from and to are allowed
                if (!canSwap(from)) {
                    revert NotAllowedToSwap(from);
                }
                if (!canSwap(to)) {
                    revert NotAllowedToSwap(to);
                }
                // Check operator (msg.sender) is allowed when acting on behalf of owner
                if (msg.sender != from && !canSwap(msg.sender)) {
                    revert NotAllowedToSwap(msg.sender);
                }
            }
        }

        // Call parent after access control checks for gas efficiency
        // (avoid enumeration updates if transfer will be reverted)
        super._beforeTokenTransfer(from, to, tokenId);
    }

    /// @notice Error thrown when not authorized to remove position
    error NotAuthorizedToRemove(uint256 tokenId);

    /// @dev Checks that the position owner is allowed (not blacklisted/frozen)
    /// @param tokenId The token ID to check
    function _checkPositionOwnerAllowed(uint256 tokenId) private view {
        address positionOwner = ownerOf(tokenId);
        if (!canSwap(positionOwner)) {
            revert NotAllowedToSwap(positionOwner);
        }
    }

    /// @inheritdoc IFusangNonfungiblePositionManager
    function removePosition(RemovePositionParams calldata params) external payable override checkDeadline(params.deadline) {
        if (!IFusangFactory(factory).isAdmin(msg.sender)) {
            revert NotAdmin(msg.sender);
        }
        _removePosition(params.tokenId, params.amount0Min, params.amount1Min);
    }

    /// @inheritdoc IFusangNonfungiblePositionManager
    function removePositions(RemovePositionParams[] calldata paramsList) external payable override {
        if (!IFusangFactory(factory).isAdmin(msg.sender)) {
            revert NotAdmin(msg.sender);
        }
        for (uint256 i = 0; i < paramsList.length; i++) {
            require(_blockTimestamp() <= paramsList[i].deadline, 'Transaction too old');
            _removePosition(paramsList[i].tokenId, paramsList[i].amount0Min, paramsList[i].amount1Min);
        }
    }
    // NOTE: removePosition uses checkDeadline modifier; removePositions checks deadline inline
    // per element because a single modifier cannot validate an array of deadlines.

    /// @dev Internal function to remove a single position
    /// @dev Admin-only, pool must be inactive (paused or expired).
    /// Normal users should use decreaseLiquidity + collect + burn instead.
    /// @param tokenId The ID of the token to remove
    /// @param amount0Min Minimum amount of token0 expected from liquidity removal
    /// @param amount1Min Minimum amount of token1 expected from liquidity removal
    function _removePosition(uint256 tokenId, uint256 amount0Min, uint256 amount1Min) private {
        Position storage position = _positions[tokenId];
        require(position.poolId != 0, "Invalid token ID");

        PoolAddress.PoolKey memory poolKey = _poolIdToPoolKey[position.poolId];
        address pool = PoolAddress.computeAddress(factory, poolKey);

        // Pool must be inactive (paused or expired)
        if (poolStateContract.isPoolActive(pool)) {
            revert PoolNotActive(pool);
        }

        address positionOwner = ownerOf(tokenId);

        // Position owner must be able to receive tokens
        if (!canSwap(positionOwner)) {
            revert NotAllowedToSwap(positionOwner);
        }

        // Step 1: Decrease all liquidity if any exists
        uint128 liquidity = position.liquidity;
        if (liquidity > 0) {
            (uint256 amount0, uint256 amount1) = IUniswapV3Pool(pool).burn(
                position.tickLower,
                position.tickUpper,
                liquidity
            );

            // Update position state after burn
            bytes32 positionKey = PositionKey.compute(
                address(this),
                position.tickLower,
                position.tickUpper
            );
            (
                ,
                uint256 feeGrowthInside0LastX128,
                uint256 feeGrowthInside1LastX128,
                ,

            ) = IUniswapV3Pool(pool).positions(positionKey);

            // Calculate principal + fees owed
            position.tokensOwed0 +=
                uint128(amount0) +
                uint128(
                    FullMath.mulDiv(
                        feeGrowthInside0LastX128 - position.feeGrowthInside0LastX128,
                        liquidity,
                        FixedPoint128.Q128
                    )
                );
            position.tokensOwed1 +=
                uint128(amount1) +
                uint128(
                    FullMath.mulDiv(
                        feeGrowthInside1LastX128 - position.feeGrowthInside1LastX128,
                        liquidity,
                        FixedPoint128.Q128
                    )
                );

            position.feeGrowthInside0LastX128 = feeGrowthInside0LastX128;
            position.feeGrowthInside1LastX128 = feeGrowthInside1LastX128;
            position.liquidity = 0;

            require(amount0 >= amount0Min, 'Price slippage check');
            require(amount1 >= amount1Min, 'Price slippage check');

            emit DecreaseLiquidity(tokenId, liquidity, amount0, amount1);
        } else {
            require(amount0Min == 0, 'Price slippage check');
            require(amount1Min == 0, 'Price slippage check');
        }

        // Step 2: Collect all tokens owed (to position owner)
        if (position.tokensOwed0 > 0 || position.tokensOwed1 > 0) {
            (uint256 amount0, uint256 amount1) = IUniswapV3Pool(pool).collect(
                positionOwner,
                position.tickLower,
                position.tickUpper,
                position.tokensOwed0,
                position.tokensOwed1
            );
            // we do not need to clear owned amounts, as we delete the position afterwards
            emit Collect(tokenId, positionOwner, uint128(amount0), uint128(amount1));
        }

        // Step 3: Burn the NFT
        delete _positions[tokenId];
        _burn(tokenId);
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
}
