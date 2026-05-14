# External Dependency Assumptions & Risk Documentation

> Last updated: 2026-04-24

---

## 1. Uniswap V3 Derived Components

### 1.1 Forked Contracts

Fusang Swap is a fork of Uniswap V3 (core v1.0.1, periphery). The following upstream contracts are included with modifications:

| Contract | Source | Modifications |
|----------|--------|---------------|
| `UniswapV3Factory` | `@uniswap/v3-core` | Base class for `FusangFactory` |
| `UniswapV3Pool` | `@uniswap/v3-core` | Added `_checkAllowed()` AllowList gate on `initialize`, `mint`, `collect`, `burn`, `swap`, `flash` |
| `UniswapV3PoolDeployer` | `@uniswap/v3-core` | No modifications |
| `SwapRouter` | Uniswap V3 periphery | Base class for `FusangSwapRouter` |
| `NonfungiblePositionManager` | Uniswap V3 periphery | Base class for `FusangNonfungiblePositionManager` |

**Assumptions:**
- Uniswap V3 core AMM logic (tick math, concentrated liquidity, fee accounting) is correct and battle-tested.
- Solidity 0.8.30 recompilation of originally 0.7.6 code preserves semantic correctness. Overflow/underflow behavior changes are accounted for by removing SafeMath wrappers.
- Oracle (TWAP) logic inherited from `UniswapV3Pool` functions correctly under the modified access control model.
- Library contracts (`TickMath`, `SqrtPriceMath`, `FullMath`, `LiquidityMath`, `SwapMath`, `BitMath`, `TickBitmap`, `Position`, `Tick`, `Oracle`) are used as-is from Uniswap V3.
- `POOL_INIT_CODE_HASH` in `PoolAddress.sol` (`0x3546d94c...`) matches the deployed pool bytecode. If pool contract bytecode changes, this hash must be recomputed or callback validation and address derivation will fail.

### 1.2 Two-Layer Access Control Model

Fusang adds two separate access control layers on top of Uniswap V3. These are distinct systems with different purposes:

| Layer | Contract | Enforced At | Purpose |
|-------|----------|-------------|---------|
| **AllowList** (contract-level) | `FusangAllowList` | Core pool (`_checkAllowed()`) | Restricts **which contracts** can call pool functions (e.g., only SwapRouter, PositionManager) |
| **WalletList** (user-level) | `WalletList` | Periphery (`FusangAccessControl`) | Restricts **which users** can swap/manage positions (whitelist/blacklist/frozenlist) |

**AllowList** delegates to WalletList for admin checks but serves a different role: it gates contract-to-pool interactions at the core level. **WalletList** manages user compliance status and is checked at the periphery level.

**Implication:** A contract that is allowlisted can call pool functions (`swap`, `mint`, `flash`, etc.) directly, bypassing periphery-level pause, close date, and user-level whitelist checks. All allowlisted contracts **must** inherit `FusangAccessControl` and call `_checkPoolActive()` before invoking pool functions.

### 1.3 Upstream Monitoring

The team should monitor:
- [Uniswap V3 Security Advisories](https://github.com/Uniswap/v3-core/security)
- [Uniswap V3 Bug Bounty disclosures](https://uniswap.org/bug-bounty)
- Solidity compiler changelogs for breaking changes affecting 0.8.30

---

## 2. ERC20 Token Compliance

### 2.1 Standard ERC20 Assumptions

The protocol assumes all tokens interacting with pools comply with the ERC20 standard:

| Assumption | Detail |
|------------|--------|
| `transfer` returns `bool` or nothing | `TransferHelper` accepts both (`data.length == 0 \|\| abi.decode(data, (bool))`) |
| `transferFrom` returns `bool` or nothing | Same pattern via `TransferHelper.safeTransferFrom` |
| `approve` returns `bool` or nothing | Same pattern via `TransferHelper.safeApprove` |
| `balanceOf` is accurate | Used for pool balance accounting |
| No fee-on-transfer | Pool accounting assumes 1:1 transfer amounts |
| No rebasing | Pool reserves assume static balances between operations |
| No callback/hook on transfer | Re-entrancy assumptions depend on this |
| Deterministic decimals | Pool math assumes fixed `decimals()` |
| `name()` and `symbol()` return `string` or `bytes32` | `SafeERC20Namer` handles both formats; used for NFT position metadata display |
| EIP-2612 `permit()` (optional) | `SelfPermit.sol` calls `IERC20Permit(token).permit()` for gasless approvals; tokens without EIP-2612 support must use standard `approve` flow instead |

### 2.2 Unsupported Token Types

The following token types are **NOT supported** and may cause loss of funds or accounting errors if used in pools:

- **Fee-on-transfer tokens** — Pool receives less than expected, breaking liquidity math.
- **Rebasing tokens** (e.g., stETH, AMPL) — Balance changes outside of transfers corrupt pool accounting.
- **Tokens with transfer hooks** (e.g., ERC-777) — May enable re-entrancy attacks via callbacks.
- **Tokens with blocklists** (e.g., USDC, USDT) — If the pool address, SwapRouter, or PositionManager is blocklisted by the token issuer, all liquidity involving that token becomes permanently locked.
- **Tokens with pausable transfers** — Pool operations fail unpredictably if token transfers are paused by the token issuer.
- **Tokens returning `false` instead of reverting** — `TransferHelper` checks return values, but some edge cases may exist.
- **Upgradeable proxy tokens** — Token behavior may change post-deployment without Fusang's knowledge.
- **Tokens with non-standard `permit()`** — `SelfPermit.sol` supports two permit variants: EIP-2612 standard (`IERC20Permit`) and DAI-style (`IERC20PermitAllowed`). Tokens with other permit implementations will revert when used via `selfPermit`/`selfPermitAllowed`. This does not block normal operations — users can fall back to standard `approve`.
- **Tokens with non-standard `name()`/`symbol()`** — `SafeERC20Namer` handles `string`, `bytes32`, and missing implementations gracefully (falls back to hex address). However, tokens returning malformed ABI data may produce garbled NFT position metadata.

### 2.3 FSC20 Token Compliance

Fusang's own FSC20 tokens include additional transfer restrictions (whitelist, blacklist, frozenlist, pause). When FSC20 tokens are used in pools:

- The pool contract address **must** be whitelisted in the FSC20's WalletList, or all swaps/liquidity operations will revert.
- The SwapRouter and NonfungiblePositionManager addresses **must** be whitelisted.
- If an FSC20 token is paused by its owner, all pool operations involving that token will fail regardless of Fusang Swap's pool state.

### 2.4 Mitigation

- Pool creation is restricted to admin-only (`FusangFactory`). Admin must verify token compliance before creating a pool.
- Only tokens that have been reviewed and approved should be paired in pools.
- Maintain a token compatibility checklist for each new pool deployment.

---

## 3. Callback Counterparties

### 3.1 Callback Functions

The protocol uses three Uniswap V3 callback interfaces:

| Callback | Implemented In | Purpose |
|----------|---------------|---------|
| `uniswapV3SwapCallback` | `FusangSwapRouter` | Pool requests token payment after swap execution |
| `uniswapV3MintCallback` | `NonfungiblePositionManager` (via `LiquidityManagement`) | Pool requests token payment after mint execution |
| `uniswapV3FlashCallback` | `PairFlash.sol` (periphery example); pool's `flash()` is fully functional | Pool requests repayment after flash loan |

### 3.2 Callback Security Model

**Validation:** All callbacks use `CallbackValidation.verifyCallback()` which:
1. Computes the expected pool address from `(factory, tokenA, tokenB, fee)` using CREATE2 deterministic addressing.
2. Verifies `msg.sender == computedPoolAddress`.
3. Reverts if the caller is not the legitimate pool.

**Assumptions:**
- The factory address used for CREATE2 validation is correct and immutable (set at construction).
- No other contract can deploy at the same CREATE2 address as a legitimate pool.
- The pool contract calls back honestly with correct `amount0Delta` / `amount1Delta` values.

---

## 4. OpenZeppelin Dependencies

### 4.1 Versions

| Project | OpenZeppelin Version | Key Contracts Used |
|---------|---------------------|-------------------|
| Swap | 4.6.0 | `ERC721`, `ERC721Enumerable` (position NFTs) |
| Token | 5.0.2 | `ERC20`, `Ownable2Step`, `AccessControl` |

**Note:** Different OpenZeppelin versions are used across the two projects. Version 5.x has breaking changes from 4.x (e.g., `Ownable` requires constructor argument, `ERC20` hooks changed).

### 4.2 Assumptions

- OpenZeppelin contracts are audited and well-tested.
- `AccessControl` role management in `WalletList` correctly enforces permission boundaries.
- `Ownable2Step` prevents accidental ownership transfer in FSC20 tokens.
- ERC721 implementation correctly handles NFT ownership, transfers, and approvals for position management.

### 4.3 Monitoring

- Track [OpenZeppelin Security Advisories](https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories) for both v4.6.0 and v5.0.2.

---

## 5. Other Package Dependencies

### 5.1 `base64-sol` (v1.1.0)

Used by `NFTDescriptor.sol` and `NFTSVG.sol` for Base64 encoding of NFT position metadata (SVG images and JSON). Purely cosmetic — does not affect swap, liquidity, or access control logic.

**Risk:** Low. Output is off-chain metadata only.

---

## 6. WETH9 Dependency

The protocol integrates with WETH9 (Wrapped Ether) for native ETH handling:

| Network | WETH9 Address |
|---------|--------------|
| Ethereum Mainnet | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| Base Sepolia | `0x4200000000000000000000000000000000000006` |

**Assumptions:**
- WETH9 contract is immutable and will remain functional.
- `deposit()` and `withdraw()` behave as expected (1:1 ETH wrapping).
- WETH9 is a standard ERC20-compliant token (no fee-on-transfer, no rebasing).
- The WETH9 address is hardcoded at deployment via constructor — changing networks requires redeployment.

---

## 7. Compiler & Toolchain

| Component | Version | Notes |
|-----------|---------|-------|
| Solidity (swap) | 0.8.30 | Upgraded from Uniswap's 0.7.6 |
| Solidity (token) | 0.8.28 | FSC20 and WalletList |
| Hardhat | Per `package.json` | Build and deployment toolchain |
| Optimizer (swap) | 200 runs (default), 1000-2000 for large contracts | Trade-off: smaller bytecode vs. higher gas per call |
| Optimizer (token) | 1,000,000 runs | Optimized for runtime gas efficiency |

**Risk:** Solidity compiler bugs may affect compiled output. Monitor [Solidity Security Alerts](https://soliditylang.org/blog/category/security-alerts/) for versions 0.8.28 and 0.8.30.

---

## 8. Dependency Management Procedures

### 8.1 New Token Onboarding

Before creating a pool with a new token:
1. Verify standard ERC20 compliance (transfer/transferFrom returns bool or nothing, approve works correctly).
2. Confirm no fee-on-transfer or rebasing mechanics.
3. Check for transfer hooks or callback mechanisms (e.g., ERC-777 hooks).
4. Check if the token has a blocklist mechanism (e.g., USDC, USDT). If yes, assess the risk of pool/router/position manager addresses being blocklisted by the token issuer.
5. Verify the token is not upgradeable, or assess upgrade risk and monitor for proxy implementation changes.
6. Ensure the token contract is verified and source code is available.
7. Whitelist the pool, SwapRouter, and PositionManager addresses in the token's WalletList (if FSC20).

### 8.2 Upstream Dependency Updates

| Dependency | Check Frequency | Action |
|------------|----------------|--------|
| Uniswap V3 security disclosures | Weekly | Assess applicability, patch if needed |
| OpenZeppelin advisories | Monthly | Assess impact on v4.6.0 and v5.0.2 |
| Solidity compiler alerts | Per release | Check for bugs affecting 0.8.28/0.8.30 |
| WETH9 contract status | As needed | No expected changes (immutable) |

### 8.3 Incident Response

If an upstream vulnerability is disclosed:
1. Assess whether Fusang's fork is affected.
2. If affected: pause all impacted pools immediately via `FusangPoolState`.
3. Develop and test a fix in a staging environment.
4. Deploy fix and unpause pools.
5. Notify users if any funds were at risk.

---

## 9. Summary of External Dependencies

| Dependency | Type | Risk Level | Mitigation |
|------------|------|------------|------------|
| Uniswap V3 Core | Forked codebase | Medium | Monitor advisories, manual patching |
| Uniswap V3 Periphery | Forked codebase | Medium | Monitor advisories, manual patching |
| `base64-sol` 1.1.0 | npm dependency (swap) | Low | NFT metadata encoding only |
| OpenZeppelin 4.6.0 | npm dependency (swap) | Low | Monitor advisories |
| OpenZeppelin 5.0.2 | npm dependency (token) | Low | Monitor advisories |
| WETH9 | External contract | Low | Immutable, well-tested |
| AllowList contract | External contract | Medium | Admin-controlled; compromise bypasses all periphery checks |
| ERC20 tokens in pools | External contracts | Medium-High | Admin-only pool creation, token onboarding checklist |
| Solidity 0.8.28/0.8.30 | Compiler | Low | Monitor compiler alerts |

---
