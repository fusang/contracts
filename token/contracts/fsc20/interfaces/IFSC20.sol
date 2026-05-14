// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '../../walletList/interfaces/IWalletList.sol';

/**
 * @title IFSC20
 * @notice Interface for FSC20 token - a compliant ERC20 token with whitelist, freeze, and document management capabilities
 * @dev Extends ERC20 functionality with access control via WalletList integration
 */
interface IFSC20 {
  // Events

  /**
   * @notice Emitted when tokens are frozen for an account
   * @param owner The address whose tokens are being frozen
   * @param value The amount of tokens frozen
   */
  event Freeze(address indexed owner, uint256 value);

  /**
   * @notice Emitted when frozen tokens are unfrozen for an account
   * @param owner The address whose tokens are being unfrozen
   * @param value The amount of tokens unfrozen
   */
  event UnFreeze(address indexed owner, uint256 value);

  /**
   * @notice Emitted when the contract pause status changes
   * @param status The new pause status (true = paused, false = unpaused)
   */
  event Paused(bool status);

  /**
   * @notice Emitted when a new document URL is added to the token
   * @param url The IPFS CID or URL of the document
   */
  event DocumentUrlAdded(string url);

  /**
   * @notice Emitted when a document URL is removed from the token
   * @param url The IPFS CID or URL that was removed
   */
  event DocumentUrlRemoved(string url);

  /**
   * @notice Emitted when frozen tokens are burned
   * @param account The account whose frozen tokens were burned
   * @param amount The amount of frozen tokens burned
   */
  event FrozenBurned(address indexed account, uint256 amount);

  // Custom error definitions

  /**
   * @notice Thrown when attempting to set pause status to its current value
   */
  error AlreadyPaused();

  /**
   * @notice Thrown when array parameters have mismatched lengths
   */
  error ArraysLengthMismatch();

  /**
   * @notice Thrown when an address is not whitelisted or is blacklisted/frozen
   * @param account The address that failed the whitelist check
   */
  error NotWhitelisted(address account);

  /**
   * @notice Thrown when a member is not registered in the system
   */
  error MemberNotRegistered();

  /**
   * @notice Thrown when attempting to unfreeze more tokens than available
   */
  error InsufficientFrozenBalance();

  /**
   * @notice Thrown when accessing an invalid array index
   */
  error IndexOutOfBounds();

  /**
   * @notice Thrown when attempting to add a duplicate document URL
   */
  error DuplicateUrl();

  /**
   * @notice Thrown when the WalletList address provided to the constructor is zero or has no contract code
   * @param walletList The invalid address that was supplied
   */
  error InvalidWalletList(address walletList);

  // External functions

  /**
   * @notice Mints new tokens to a specified address
   * @dev Only callable by contract owner
   * @param to The address to receive the minted tokens
   * @param amount The amount of tokens to mint
   */
  function mint(address to, uint256 amount) external;

  /**
   * @notice Mints tokens to multiple addresses in a single transaction
   * @dev Only callable by contract owner. Arrays must have matching lengths
   * @param to Array of addresses to receive tokens
   * @param amounts Array of amounts corresponding to each address
   */
  function batchMint(address[] calldata to, uint256[] calldata amounts) external;

  /**
   * @notice Burns tokens from the caller's balance
   * @param amount The amount of tokens to burn
   */
  function burn(uint256 amount) external;

  /**
   * @notice Burns tokens from multiple addresses in a single transaction
   * @dev Only callable by contract owner. Arrays must have matching lengths
   * @param from Array of addresses to burn tokens from
   * @param amounts Array of amounts corresponding to each address
   */
  function batchBurn(address[] calldata from, uint256[] calldata amounts) external;

  /**
   * @notice Sets the pause status of the contract
   * @dev Only callable by contract owner. When paused, transfers and approvals are disabled
   * @param status The desired pause status (true = paused, false = unpaused)
   */
  function pause(bool status) external;

  /**
   * @notice Adds a document URL (typically IPFS CID) to the token
   * @dev Only callable by contract owner
   * @param url The IPFS CID or URL to add
   */
  function addDocumentUrl(string calldata url) external;

  /**
   * @notice Removes a document URL at the specified index
   * @dev Only callable by contract owner. Uses swap-and-pop for gas efficiency
   * @param index The index of the document URL to remove
   */
  function removeDocumentUrl(uint256 index) external;

  /**
   * @notice Freezes tokens for multiple accounts
   * @dev Transfers tokens to the contract and tracks frozen balances
   * @param accounts Array of account addresses
   * @param amounts Array of amounts to freeze for each account
   * @return bool True if successful
   */
  function batchFreeze(address[] calldata accounts, uint256[] calldata amounts) external returns (bool);

  /**
   * @notice Unfreezes tokens for multiple accounts
   * @dev Returns frozen tokens from the contract back to the accounts
   * @param accounts Array of account addresses
   * @param amounts Array of amounts to unfreeze for each account
   * @return bool True if successful
   */
  function batchUnFreeze(address[] calldata accounts, uint256[] calldata amounts) external returns (bool);

  /**
   * @notice Burns frozen tokens from multiple accounts
   * @dev Only callable by contract owner. Permanently destroys frozen tokens
   * @param accounts Array of account addresses
   * @param amounts Array of frozen token amounts to burn
   */
  function batchBurnFrozen(address[] calldata accounts, uint256[] calldata amounts) external;

  // View functions

  /**
   * @notice Returns the WalletList contract instance
   * @return IWalletList The WalletList contract used for access control
   */
  function walletListContract() external view returns (IWalletList);

  /**
   * @notice Returns the current pause status
   * @return bool True if contract is paused, false otherwise
   */
  function paused() external view returns (bool);

  /**
   * @notice Returns the frozen balance for a specific account
   * @param account The address to query
   * @return uint256 The amount of frozen tokens
   */
  function frozenBalance(address account) external view returns (uint256);

  /**
   * @notice Returns all document URLs associated with this token
   * @return string[] Array of IPFS CIDs or URLs
   */
  function getIpfsCids() external view returns (string[] memory);
}
