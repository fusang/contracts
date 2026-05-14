# External Dependency Assumptions & Risk Documentation — Token Project

> Last updated: 2026-04-24

---

## 1. OpenZeppelin Contracts (v5.0.2)

### 1.1 Contracts Used

| Contract | Used By | Purpose |
|----------|---------|---------|
| `ERC20` | `FSC20` | Standard token accounting, transfer, approval logic |
| `Ownable2Step` | `FSC20`, `WalletList`, `FSC20Factory` | Two-step ownership transfer for all contracts |
| `Ownable` | (inherited via `Ownable2Step`) | Base ownership with `onlyOwner` modifier |

### 1.2 Assumptions

- `ERC20._update()` hook is called on every mint, burn, and transfer — FSC20 overrides this for compliance checks.
- `ERC20.approve()` is overridable — FSC20 overrides to enforce compliance checks on both caller and spender.
- `Ownable2Step` requires explicit `acceptOwnership()` by the new owner, preventing accidental transfer. This is critical because token owner has `mint`, `batchMint`, `burn`, `batchBurn`, `batchBurnFrozen`, `pause`, and document management powers.
- `Ownable._msgSender()` returns `msg.sender` in all cases (no meta-transaction support assumed).

### 1.3 Risks

- OpenZeppelin v5.0.2 breaking changes from v4.x: `Ownable` constructor requires explicit `initialOwner` parameter, `ERC20._update()` replaces `_beforeTokenTransfer()`/`_afterTokenTransfer()`. These changes are already accounted for in the current code.
- Future OZ security advisories may require patching. Monitor [OpenZeppelin Security Advisories](https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories).

---

## 2. WalletList — Shared Access Control Contract

### 2.1 Architecture

`WalletList` is the single source of truth for address compliance across both the token and swap projects:

| Consumer | How It Uses WalletList |
|----------|----------------------|
| `FSC20` | Reads `addressList` mapping to check whitelist/blacklist/frozenlist status on every transfer and approval |
| `FSC20Factory` | Passes WalletList reference to newly deployed FSC20 tokens |
| Fusang Swap (`FusangAccessControl`) | Reads WalletList via AllowList to check user swap permissions |
| Fusang Swap (`FusangAllowList`) | Delegates `isAdmin()` check to WalletList |

### 2.2 Assumptions

- `WalletList` is deployed once and shared by all FSC20 tokens and Fusang Swap contracts.
- `WalletList.addressList` mapping is the sole authority for list membership — `address(0)` means not listed.
- Admin role (`DEFAULT_ADMIN_ROLE = 0x00`) is managed via `addAdmin`/`removeAdmin` (owner-only), not via generic list functions.
- `MEMBER` role permissions are configured at deployment (default): members can manage `WHITELIST` and `FROZENLIST`. `BLACKLIST` and `DEFAULT_ADMIN_ROLE` are not assigned to any role by default, but admin can change this post-deployment via `setRoleManageList()`.
- `WalletList` does not use OpenZeppelin `AccessControl` — it implements its own role system via `addressList` and `roleManageList` mappings.

---

## 3. FSC20 Token — External Integration Assumptions

### 3.1 ERC20 Standard Compliance

FSC20 tokens are ERC20-compliant with additional restrictions. External systems integrating with FSC20 must be aware:

| Behavior | Standard ERC20 | FSC20 |
|----------|---------------|-------|
| `transfer` | Always succeeds if balance sufficient | Non-owner: reverts if sender or receiver fails `canTransfer()` (whitelist + not frozen + not blacklisted), or if paused. Owner: only requires both parties whitelisted (frozen/blacklist bypassed) |
| `transferFrom` | Always succeeds if allowance and balance sufficient | Same as `transfer`, plus checks spender compliance (`canTransfer(msg.sender)`) when `msg.sender != from` |
| `approve` | Always succeeds | Reverts if caller or spender fails `canTransfer()`, or if paused (for non-zero amounts) |
| `balanceOf` | Returns total balance | Returns total balance (frozen tokens are held by contract address, not by user) |

### 3.2 Freeze Mechanism

FSC20's freeze mechanism transfers tokens from the user to the contract address (`address(this)`). This means:
- `balanceOf(user)` decreases when tokens are frozen.
- `balanceOf(address(token))` increases, holding all frozen tokens.
- External systems querying `totalSupply` will include frozen tokens.
- Frozen tokens can be burned by the owner via `batchBurnFrozen`.

### 3.3 IPFS Document References

FSC20 stores IPFS CIDs via `addDocumentUrl`/`removeDocumentUrl`. These are on-chain string references to off-chain content.

**Assumptions:**
- IPFS content addressed by stored CIDs remains pinned and accessible via IPFS gateways.
- CID integrity is guaranteed by content-addressing (hash of content), so stored CIDs cannot be tampered with.

**Risk:** If IPFS pinning service stops pinning the content, the CIDs remain on-chain but the referenced documents become inaccessible. This affects compliance documentation availability but not token functionality.

---

## 4. Compiler & Toolchain

| Component | Version | Notes |
|-----------|---------|-------|
| Solidity | ^0.8.9 (pragma), compiled with 0.8.28 | All token contracts |
| Hardhat | Per `package.json` | Build and deployment toolchain |
| Optimizer | 1,000,000 runs | Optimized for runtime gas efficiency (many calls expected) |

**Risk:** Solidity compiler bugs may affect compiled output. Monitor [Solidity Security Alerts](https://soliditylang.org/blog/category/security-alerts/) for version 0.8.28.

---

## 5. Dependency Management

### 5.1 Upstream Monitoring

| Dependency | Check Frequency | Action |
|------------|----------------|--------|
| OpenZeppelin 5.0.2 advisories | Monthly | Assess impact, patch if needed |
| Solidity compiler alerts | Per release | Check for bugs affecting 0.8.28 |
| WalletList contract integrity | Ongoing | Monitor admin role changes on-chain |

---

## 6. Summary of External Dependencies

| Dependency | Type | Risk Level | Mitigation |
|------------|------|------------|------------|
| OpenZeppelin 5.0.2 | npm dependency | Low | Monitor advisories |
| WalletList contract | Shared external contract | Medium | Immutable reference; compromise affects all tokens and swap pools |
| Fusang Swap integration | Cross-project dependency | Medium | Independent pause systems; no coordination mechanism |
| Solidity 0.8.28 | Compiler | Low | Monitor compiler alerts |

---
