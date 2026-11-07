// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Threshold-aware 2-of-3 treasury
/// @notice Large withdrawals require two approvals; smaller operations require one.
contract MultiSigTreasury is ReentrancyGuard {
    struct Transaction {
        address payable target;
        uint128 value;
        uint64 confirmations;
        bool executed;
        bytes data;
    }

    address[3] public owners;
    mapping(address owner => bool isOwner) public isOwner;
    uint256 public immutable largeWithdrawalThreshold;
    uint256 public transactionCount;

    mapping(uint256 transactionId => Transaction transaction) private _transactions;
    mapping(uint256 transactionId => mapping(address owner => bool confirmed)) public isConfirmed;

    error NotOwner();
    error InvalidOwners();
    error InvalidTarget();
    error TransactionNotFound();
    error AlreadyConfirmed();
    error NotConfirmed();
    error AlreadyExecuted();
    error InsufficientConfirmations();
    error InsufficientBalance();
    error ExecutionFailed();
    error AmountOverflow();

    event Deposit(address indexed sender, uint256 amount, uint256 balance);
    event TransactionSubmitted(uint256 indexed transactionId, address indexed owner, address indexed target, uint256 value);
    event TransactionConfirmed(uint256 indexed transactionId, address indexed owner);
    event ConfirmationRevoked(uint256 indexed transactionId, address indexed owner);
    event TransactionExecuted(uint256 indexed transactionId, address indexed executor);

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    constructor(address[3] memory initialOwners, uint256 threshold) {
        for (uint256 i = 0; i < 3; ++i) {
            address owner = initialOwners[i];
            if (owner == address(0) || isOwner[owner]) revert InvalidOwners();
            isOwner[owner] = true;
            owners[i] = owner;
        }
        largeWithdrawalThreshold = threshold;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value, address(this).balance);
    }

    function submitTransaction(address payable target, uint256 value, bytes calldata data)
        external
        onlyOwner
        returns (uint256 transactionId)
    {
        if (target == address(0)) revert InvalidTarget();
        if (value > type(uint128).max) revert AmountOverflow();

        transactionId = transactionCount++;
        _transactions[transactionId] = Transaction({
            target: target,
            value: uint128(value),
            confirmations: 1,
            executed: false,
            data: data
        });
        isConfirmed[transactionId][msg.sender] = true;

        emit TransactionSubmitted(transactionId, msg.sender, target, value);
        emit TransactionConfirmed(transactionId, msg.sender);
    }

    function confirmTransaction(uint256 transactionId) external onlyOwner {
        Transaction storage transaction = _transaction(transactionId);
        if (transaction.executed) revert AlreadyExecuted();
        if (isConfirmed[transactionId][msg.sender]) revert AlreadyConfirmed();

        isConfirmed[transactionId][msg.sender] = true;
        ++transaction.confirmations;
        emit TransactionConfirmed(transactionId, msg.sender);
    }

    function revokeConfirmation(uint256 transactionId) external onlyOwner {
        Transaction storage transaction = _transaction(transactionId);
        if (transaction.executed) revert AlreadyExecuted();
        if (!isConfirmed[transactionId][msg.sender]) revert NotConfirmed();

        isConfirmed[transactionId][msg.sender] = false;
        --transaction.confirmations;
        emit ConfirmationRevoked(transactionId, msg.sender);
    }

    function executeTransaction(uint256 transactionId) external onlyOwner nonReentrant {
        Transaction storage transaction = _transaction(transactionId);
        if (transaction.executed) revert AlreadyExecuted();
        if (transaction.confirmations < requiredConfirmations(transaction.value, transaction.data.length != 0)) {
            revert InsufficientConfirmations();
        }
        if (transaction.value > address(this).balance) revert InsufficientBalance();

        transaction.executed = true;
        (bool success,) = transaction.target.call{value: transaction.value}(transaction.data);
        if (!success) revert ExecutionFailed();

        emit TransactionExecuted(transactionId, msg.sender);
    }

    /// @notice Two owners are needed above the ETH threshold, and for any call
    /// carrying calldata: such a call can move ERC-20 balances or change state
    /// elsewhere while sending zero ETH, which a value-only rule would miss.
    function requiredConfirmations(uint256 value, bool carriesData) public view returns (uint256) {
        if (carriesData) return 2;
        return value > largeWithdrawalThreshold ? 2 : 1;
    }

    function getTransaction(uint256 transactionId) external view returns (Transaction memory) {
        Transaction storage transaction = _transaction(transactionId);
        return transaction;
    }

    function _transaction(uint256 transactionId) private view returns (Transaction storage transaction) {
        if (transactionId >= transactionCount) revert TransactionNotFound();
        transaction = _transactions[transactionId];
    }
}
