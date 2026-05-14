// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import '@openzeppelin/contracts/access/Ownable2Step.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '../walletList/interfaces/IWalletList.sol';
import './interfaces/IFSC20.sol';

/**
 * @title FSC20
 * @notice A compliant ERC20 token with whitelist, blacklist, freeze, pause, and document management capabilities
 * @dev Implements ERC20 with additional access control features using WalletList
 *
 * Key Features:
 * - Whitelist/Blacklist/Frozenlist support via WalletList contract
 * - Token freezing mechanism to lock tokens temporarily
 * - Pause functionality to halt all transfers and approvals
 * - Document management via IPFS CIDs
 * - Batch operations for gas efficiency
 *
 * Access Control Roles (managed by WalletList):
 * - MEMBER: Members who can manage whitelists and frozen lists
 * - WHITELIST: Addresses allowed to hold and transfer tokens
 * - FROZENLIST: Addresses whose transfers are frozen
 * - BLACKLIST: Addresses completely blocked from transactions
 */
contract FSC20 is IFSC20, ERC20, Ownable2Step {
  /// @notice The WalletList contract used for access control
  IWalletList public immutable walletListContract;

  /// @notice Whether the contract is currently paused
  bool public paused;

  /// @notice Mapping of addresses to their frozen token balances
  mapping(address => uint256) public frozenBalance;

  /// @notice Array of IPFS CIDs for associated documents
  string[] public ipfsCids;

  /// @notice Role identifier for members who can manage lists
  bytes32 public constant MEMBER = keccak256('MEMBER');

  /// @notice List identifier for whitelisted addresses
  bytes32 public constant WHITELIST = keccak256('WHITELIST');

  /// @notice List identifier for frozen addresses
  bytes32 public constant FROZENLIST = keccak256('FROZENLIST');

  /// @notice List identifier for blacklisted addresses
  bytes32 public constant BLACKLIST = keccak256('BLACKLIST');

  /**
   * @notice Constructs a new FSC20 token
   * @param name_ The name of the token
   * @param symbol_ The symbol of the token
   * @param walletListContract_ The WalletList contract address for access control
   */
  constructor(string memory name_, string memory symbol_, IWalletList walletListContract_) ERC20(name_, symbol_) Ownable(_msgSender()) {
    address walletListAddr = address(walletListContract_);
    if (walletListAddr == address(0) || walletListAddr.code.length == 0) {
      revert InvalidWalletList(walletListAddr);
    }
    walletListContract = walletListContract_;
  }

  /**
   * @notice Modifier to check if the contract is not paused
   * @dev Reverts if the contract is currently paused
   */
  modifier whenNotPaused() {
    if (paused) {
      revert AlreadyPaused();
    }
    _;
  }

  /**
   * @notice Mints new tokens to a specified address
   * @dev Only callable by the contract owner
   * @param to The address to receive the minted tokens
   * @param amount The amount of tokens to mint
   */
  function mint(address to, uint256 amount) external onlyOwner {
    _mint(to, amount);
  }

  /**
   * @notice Mints tokens to multiple addresses in a single transaction
   * @dev Only callable by the contract owner. More gas efficient than multiple mint calls
   * @param to Array of addresses to receive tokens
   * @param amounts Array of token amounts corresponding to each address
   * @custom:throws ArraysLengthMismatch if array lengths don't match
   */
  function batchMint(address[] calldata to, uint256[] calldata amounts) external onlyOwner {
    if (to.length != amounts.length) {
      revert ArraysLengthMismatch();
    }
    for (uint256 i = 0; i < to.length; i++) {
      _mint(to[i], amounts[i]);
    }
  }

  /**
   * @notice Burns tokens from the caller's balance
   * @param amount The amount of tokens to burn
   */
  function burn(uint256 amount) external {
    _burn(_msgSender(), amount);
  }

  /**
   * @notice Burns tokens from multiple addresses in a single transaction
   * @dev Only callable by the contract owner
   * @param from Array of addresses to burn tokens from
   * @param amounts Array of token amounts corresponding to each address
   * @custom:throws ArraysLengthMismatch if array lengths don't match
   */
  function batchBurn(address[] calldata from, uint256[] calldata amounts) external onlyOwner {
    if (from.length != amounts.length) {
      revert ArraysLengthMismatch();
    }
    for (uint256 i = 0; i < from.length; i++) {
      _burn(from[i], amounts[i]);
    }
  }

  /**
   * @notice Sets the pause status of the contract
   * @dev Only callable by the contract owner. When paused, all transfers and approvals are disabled
   * @param status The desired pause status (true = paused, false = unpaused)
   * @custom:throws AlreadyPaused if trying to set the same status
   */
  function pause(bool status) external onlyOwner {
    if (paused == status) {
      revert AlreadyPaused();
    }
    paused = status;
    emit Paused(status);
  }

  /**
   * @notice Checks if an address can transfer tokens
   * @dev An address can transfer if it's whitelisted and not in frozen or blacklists
   * @param account The address to check
   * @return bool True if the address can transfer, false otherwise
   */
  function canTransfer(address account) public view returns (bool) {
    return _isAddressInList(WHITELIST, account, address(0))
        && !_isAddressInList(FROZENLIST, account, address(0))
        && !_isAddressInList(BLACKLIST, account, address(0));
  }

  /**
   * @notice Internal function that handles token transfers with access control
   * @dev Overrides ERC20 _update to enforce whitelist/blacklist/frozenlist checks
   * @param from The address sending tokens (address(0) for minting)
   * @param to The address receiving tokens (address(0) for burning)
   * @param amount The amount of tokens to transfer
   * @custom:throws NotWhitelisted if sender or receiver fails access control checks
   * @custom:security Security note: The owner can transfer tokens even if addresses are frozen or blacklisted, but both sender and receiver must still be whitelisted.
   */
  function _update(address from, address to, uint256 amount) internal virtual override whenNotPaused {
    if (_msgSender() != owner()) {
      if (from != address(0) && !canTransfer(from)) {
        revert NotWhitelisted(from);
      }
      if (to != address(0) && !canTransfer(to)) {
        revert NotWhitelisted(to);
      }
      if (from != address(0) && _msgSender() != from && !canTransfer(_msgSender())) {
        revert NotWhitelisted(_msgSender());
      }
    } else {
      if (from != address(0) && !_isAddressInList(WHITELIST, from, address(0))) {
        revert NotWhitelisted(from);
      }
      if (to != address(0) && !_isAddressInList(WHITELIST, to, address(0))) {
        revert NotWhitelisted(to);
      }
    }
    super._update(from, to, amount);
  }

  /**
   * @notice Approves a spender to spend tokens on behalf of the caller
   * @dev Overrides ERC20 approve to enforce whitelist checks on both parties
   * @param spender The address authorized to spend tokens
   * @param amount The amount of tokens the spender can transfer
   * @return bool True if approval was successful
   * @custom:throws NotWhitelisted if caller or spender is not whitelisted
   */
  function approve(address spender, uint256 amount) public virtual override returns (bool) {
    if (!canTransfer(_msgSender())) {
      revert NotWhitelisted(_msgSender());
    }
    if (amount != 0) {
      if (paused) {
        revert AlreadyPaused();
      }
      if (!canTransfer(spender)) {
        revert NotWhitelisted(spender);
      }
    }
    return super.approve(spender, amount);
  }

  /**
   * @notice Freezes tokens for multiple accounts in a single transaction
   * @dev Transfers tokens to the contract and tracks them in frozenBalance mapping
   * @param accounts Array of account addresses to freeze tokens for
   * @param amounts Array of token amounts to freeze for each account
   * @return bool True if successful
   * @custom:throws ArraysLengthMismatch if array lengths don't match
   * @custom:throws MemberNotRegistered if caller is not authorized to freeze for the account
   * @custom:security Only the owner or the member who whitelisted an account can freeze their tokens
   */
  function batchFreeze(address[] calldata accounts, uint256[] calldata amounts) external virtual returns (bool) {
    if (accounts.length != amounts.length) {
      revert ArraysLengthMismatch();
    }

    for (uint256 i = 0; i < accounts.length; i++) {
      if (!_isAddressInList(WHITELIST, accounts[i], _msgSender()) && _msgSender() != owner()) {
        revert MemberNotRegistered();
      }
      _freeze(accounts[i], amounts[i]);
    }
    return true;
  }

  /**
   * @notice Unfreezes tokens for multiple accounts in a single transaction
   * @dev Returns frozen tokens from the contract back to the account owners
   * @param accounts Array of account addresses to unfreeze tokens for
   * @param amounts Array of token amounts to unfreeze for each account
   * @return bool True if successful
   * @custom:throws ArraysLengthMismatch if array lengths don't match
   * @custom:throws MemberNotRegistered if caller is not authorized to unfreeze for the account
   * @custom:throws InsufficientFrozenBalance if trying to unfreeze more than available
   */
  function batchUnFreeze(address[] calldata accounts, uint256[] calldata amounts) external virtual returns (bool) {
    if (accounts.length != amounts.length) {
      revert ArraysLengthMismatch();
    }

    for (uint256 i = 0; i < accounts.length; i++) {
      if (!_isAddressInList(WHITELIST, accounts[i], _msgSender()) && _msgSender() != owner()) {
        revert MemberNotRegistered();
      }
      _unFreeze(accounts[i], amounts[i]);
    }
    return true;
  }

  /**
   * @notice Internal helper to check if an address is in a specific list
   * @dev Queries the WalletList contract for list membership
   * @param listName The name of the list to check (WHITELIST, FROZENLIST, BLACKLIST, etc.)
   * @param account The address to check
   * @param memberAddress The expected member address (address(0) means check if listed at all)
   * @return bool True if the address is in the list according to the criteria
   */
  function _isAddressInList(bytes32 listName, address account, address memberAddress) internal view returns (bool) {
    if (memberAddress == address(0)) {
      return walletListContract.addressList(listName, account) != memberAddress;
    }
    return walletListContract.addressList(listName, account) == memberAddress;
  }

  /**
   * @notice Internal function to freeze tokens for an account
   * @dev Transfers tokens to the contract and increments frozen balance
   * @param account The account whose tokens are being frozen
   * @param amount The amount of tokens to freeze
   */
  function _freeze(address account, uint256 amount) internal virtual {
    _transfer(account, address(this), amount);
    frozenBalance[account] = frozenBalance[account] + amount;
    emit Freeze(account, amount);
  }

  /**
   * @notice Internal function to unfreeze tokens for an account
   * @dev Transfers frozen tokens back to the owner and decrements frozen balance
   * @param account The account whose tokens are being unfrozen
   * @param amount The amount of tokens to unfreeze
   * @custom:throws InsufficientFrozenBalance if amount exceeds frozen balance
   */
  function _unFreeze(address account, uint256 amount) internal virtual {
    if (frozenBalance[account] < amount) {
      revert InsufficientFrozenBalance();
    }
    _transfer(address(this), account, amount);
    frozenBalance[account] = frozenBalance[account] - amount;
    emit UnFreeze(account, amount);
  }

  /**
   * @notice Adds a document URL (typically IPFS CID) to the token
   * @dev Only callable by the contract owner
   * @param url The IPFS CID or URL to add
   */
  function addDocumentUrl(string calldata url) external onlyOwner {
    for (uint256 i = 0; i < ipfsCids.length; i++) {
      if (keccak256(bytes(ipfsCids[i])) == keccak256(bytes(url))) {
        revert DuplicateUrl();
      }
    }
    ipfsCids.push(url);
    emit DocumentUrlAdded(url);
  }

  /**
   * @notice Removes a document URL at the specified index
   * @dev Only callable by the contract owner. Uses swap-and-pop for gas efficiency
   * @param index The index of the document URL to remove
   * @custom:throws IndexOutOfBounds if index is invalid
   */
  function removeDocumentUrl(uint256 index) external onlyOwner {
    if (index >= ipfsCids.length) {
      revert IndexOutOfBounds();
    }
    string memory removedUrl = ipfsCids[index];
    ipfsCids[index] = ipfsCids[ipfsCids.length - 1];
    ipfsCids.pop();
    emit DocumentUrlRemoved(removedUrl);
  }

  /**
   * @notice Returns all document URLs associated with this token
   * @return string[] Array of IPFS CIDs or URLs
   */
  function getIpfsCids() external view returns (string[] memory) {
    return ipfsCids;
  }

  /**
   * @notice Burns frozen tokens from multiple accounts
   * @dev Only callable by the contract owner. Permanently destroys frozen tokens
   * @param accounts Array of account addresses whose frozen tokens will be burned
   * @param amounts Array of frozen token amounts to burn for each account
   * @custom:throws ArraysLengthMismatch if array lengths don't match
   * @custom:throws InsufficientFrozenBalance if account has insufficient frozen balance
   */
  function batchBurnFrozen(address[] calldata accounts, uint256[] calldata amounts) external onlyOwner {
    if (accounts.length != amounts.length) {
      revert ArraysLengthMismatch();
    }

    for (uint256 i = 0; i < accounts.length; i++) {
      if (frozenBalance[accounts[i]] < amounts[i]) {
        revert InsufficientFrozenBalance();
      }

      frozenBalance[accounts[i]] = frozenBalance[accounts[i]] - amounts[i];
      _burn(address(this), amounts[i]);

      emit FrozenBurned(accounts[i], amounts[i]);
    }
  }
}
