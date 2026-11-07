// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ICFDToken} from "./interfaces/ICFDToken.sol";

/// @title Crowdfund DAO governance token
/// @notice Le cahier des charges impose un vote « pondéré par solde de CFD ».
///         Le pouvoir de vote d'une adresse est donc exactement son solde :
///         aucune délégation préalable n'est requise et la délégation à un
///         tiers est désactivée. Les soldes restent horodatés par les
///         checkpoints ERC20Votes, ce qui permet le vote sur solde figé
///         (snapshot) exigé par la section 5 du cahier des charges.
contract CFDToken is ERC20, ERC20Votes, AccessControl, Pausable, ICFDToken {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    error ZeroAddress();
    error ContributionTokensLocked();
    error DelegationDisabled();
    mapping(address account => uint256 amount) public lockedBalance;
    event VotingPowerReleased(address indexed account, uint256 amount);

    constructor(address admin) ERC20("Crowdfund DAO", "CFD") EIP712("Crowdfund DAO", "1") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function mint(address to, uint256 amount) external override onlyRole(MINTER_ROLE) {
        lockedBalance[to] += amount;
        _mint(to, amount);
    }

    /// @dev Used by the crowdfunding core when a failed contribution is refunded.
    /// Contribution tokens cannot leave their holder before payout, so refunds
    /// always destroy the full associated voting power.
    function burnVotingPower(address from, uint256 amount)
        external
        override
        onlyRole(BURNER_ROLE)
        returns (uint256 burned)
    {
        lockedBalance[from] -= amount;
        _burn(from, amount);
        return amount;
    }

    function releaseVotingPower(address from, uint256 amount) external override onlyRole(BURNER_ROLE) {
        lockedBalance[from] -= amount;
        emit VotingPowerReleased(from, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice La délégation n'est pas prévue par le cahier des charges et
    ///         détacherait le pouvoir de vote du solde de CFD. Les deux points
    ///         d'entrée d'OpenZeppelin sont neutralisés pour qu'aucune voix ne
    ///         puisse être transférée indépendamment des jetons.
    function delegate(address) public pure override {
        revert DelegationDisabled();
    }

    /// @notice Variante signée de `delegate`, désactivée pour la même raison.
    function delegateBySig(address, uint256, uint256, uint8, bytes32, bytes32) public pure override {
        revert DelegationDisabled();
    }

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        // Only the authorized refund path burns. A token pause must not block
        // refunds when the Core itself remains available.
        if (to != address(0)) _requireNotPaused();
        if (from != address(0) && to != address(0) && value > balanceOf(from) - lockedBalance[from]) {
            revert ContributionTokensLocked();
        }
        super._update(from, to, value);
        // Auto-délégation à la première réception : sans elle, ERC20Votes
        // laisserait le pouvoir de vote à zéro tant que le détenteur n'agit
        // pas. Le solde devient ainsi directement la pondération du vote.
        if (to != address(0) && delegates(to) == address(0)) _delegate(to, to);
    }
}
