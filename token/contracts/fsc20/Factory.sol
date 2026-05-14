// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.9;

import './FSC20.sol';
import '../walletList/interfaces/IWalletList.sol';

/**
 * @title FSC20Factory
 * @notice Factory contract for deploying FSC20 tokens with standardized WalletList integration
 * @dev Only the factory owner can deploy new tokens. Each deployed token shares the same WalletList contract
 *
 * Key Features:
 * - Centralized token deployment with consistent access control
 * - All deployed tokens use the same WalletList contract
 * - Ownership of deployed tokens is transferred to the deployer
 * - Event emission for tracking deployed tokens
 */
contract FSC20Factory is Ownable2Step {
  /// @notice The WalletList contract used by all deployed tokens
  IWalletList public immutable walletListContract;

  /**
   * @notice Emitted when a new FSC20 token is deployed
   * @param token The address of the newly deployed FSC20 token
   */
  event FSC20TokenCreated(address token);

  /**
   * @notice Thrown when the WalletList address provided to the constructor is zero or has no contract code
   * @param walletList The invalid address that was supplied
   */
  error InvalidWalletList(address walletList);

  /**
   * @notice Constructs a new FSC20Factory
   * @param walletListContract_ The WalletList contract address to be used by all deployed tokens
   */
  constructor(IWalletList walletListContract_) Ownable(_msgSender()) {
    address walletListAddr = address(walletListContract_);
    if (walletListAddr == address(0) || walletListAddr.code.length == 0) {
      revert InvalidWalletList(walletListAddr);
    }
    walletListContract = walletListContract_;
  }

  /**
   * @notice Deploys a new FSC20 token with the specified name and symbol
   * @dev Only callable by the factory owner. Ownership of the new token is transferred to msg.sender
   * @param name_ The name of the new token
   * @param symbol_ The symbol of the new token
   * @custom:emits FSC20TokenCreated with the address of the deployed token
   */
  function deploy(string memory name_, string memory symbol_) external onlyOwner {
    FSC20 token = new FSC20(name_, symbol_, walletListContract);
    token.transferOwnership(msg.sender);
    emit FSC20TokenCreated(address(token));
  }
}
