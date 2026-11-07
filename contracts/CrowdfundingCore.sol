// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICFDToken} from "./interfaces/ICFDToken.sol";
import {ICrowdfundingGovernance} from "./interfaces/ICrowdfundingGovernance.sol";

/// @title Crowdfund DAO campaign registry and escrow
/// @notice Holds campaign funds until success, failure, or a governance decision.
contract CrowdfundingCore is AccessControl, Pausable, ReentrancyGuard, ICrowdfundingGovernance {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum CampaignState {
        Active,
        Successful,
        Failed,
        Frozen,
        Cancelled,
        PaidOut
    }

    struct Campaign {
        address creator;
        address payable beneficiary;
        uint128 goal;
        uint128 totalRaised;
        uint64 deadline;
        CampaignState storedState;
        bool earlyReleaseApproved;
        string metadataHash;
    }

    ICFDToken public immutable governanceToken;
    uint256 public immutable tokensPerEth;
    uint256 public override nextCampaignId;

    mapping(uint256 campaignId => Campaign campaign) private _campaigns;
    mapping(uint256 campaignId => mapping(address contributor => uint256 amount)) public contributions;
    mapping(uint256 campaignId => mapping(address contributor => bool released)) public votingTokensReleased;

    error ZeroAddress();
    error InvalidGoal();
    error InvalidDeadline();
    error InvalidTokenRate();
    error CampaignNotFound();
    error CampaignNotActive();
    error CampaignClosed();
    error ContributionExceedsGoal(uint256 remainingAmount);
    error ZeroContribution();
    error NotBeneficiary();
    error FundsLocked();
    error NothingToRefund();
    error RefundUnavailable();
    error TransferFailed();
    error AmountOverflow();
    error TokensAlreadyReleased();

    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed creator,
        address indexed beneficiary,
        uint256 goal,
        uint256 deadline,
        string metadataHash
    );
    event ContributionReceived(
        uint256 indexed campaignId,
        address indexed contributor,
        uint256 amount,
        uint256 tokenAmount
    );
    event CampaignGoalReached(uint256 indexed campaignId, uint256 totalRaised);
    event FundsWithdrawn(uint256 indexed campaignId, address indexed beneficiary, uint256 amount);
    /// @param burnedTokens Exact CFD destroyed for the refunded contribution.
    event Refunded(
        uint256 indexed campaignId,
        address indexed contributor,
        uint256 amount,
        uint256 burnedTokens
    );
    event CampaignFrozen(uint256 indexed campaignId);
    event CampaignCancelled(uint256 indexed campaignId);
    event EarlyReleaseApproved(uint256 indexed campaignId);
    event ReleaseApproved(uint256 indexed campaignId);

    constructor(address tokenAddress, address admin, uint256 tokenRate) {
        if (tokenAddress == address(0) || admin == address(0)) revert ZeroAddress();
        if (tokenRate == 0) revert InvalidTokenRate();

        governanceToken = ICFDToken(tokenAddress);
        tokensPerEth = tokenRate;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function createCampaign(
        uint256 goal,
        uint64 deadline,
        address payable beneficiary,
        string calldata metadataHash
    ) external whenNotPaused returns (uint256 campaignId) {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (goal == 0 || goal > type(uint128).max) revert InvalidGoal();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        campaignId = nextCampaignId++;
        _campaigns[campaignId] = Campaign({
            creator: msg.sender,
            beneficiary: beneficiary,
            goal: uint128(goal),
            totalRaised: 0,
            deadline: deadline,
            storedState: CampaignState.Active,
            earlyReleaseApproved: false,
            metadataHash: metadataHash
        });

        emit CampaignCreated(campaignId, msg.sender, beneficiary, goal, deadline, metadataHash);
    }

    function contribute(uint256 campaignId) external payable whenNotPaused nonReentrant {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.storedState != CampaignState.Active) revert CampaignNotActive();
        if (campaign.earlyReleaseApproved) revert CampaignClosed();
        if (block.timestamp >= campaign.deadline) revert CampaignClosed();
        if (campaign.totalRaised >= campaign.goal) revert CampaignClosed();
        if (msg.value == 0) revert ZeroContribution();
        if (uint256(campaign.totalRaised) + msg.value > type(uint128).max) revert AmountOverflow();
        if (uint256(campaign.totalRaised) + msg.value > campaign.goal) {
            revert ContributionExceedsGoal(uint256(campaign.goal) - campaign.totalRaised);
        }

        campaign.totalRaised += uint128(msg.value);
        contributions[campaignId][msg.sender] += msg.value;

        // 1 ETH contribution mints `tokensPerEth` whole CFD tokens.
        uint256 tokenAmount = msg.value * tokensPerEth;
        governanceToken.mint(msg.sender, tokenAmount);

        emit ContributionReceived(campaignId, msg.sender, msg.value, tokenAmount);
        if (campaign.totalRaised == campaign.goal) emit CampaignGoalReached(campaignId, campaign.totalRaised);
    }

    function withdrawFunds(uint256 campaignId) external whenNotPaused nonReentrant {
        Campaign storage campaign = _campaign(campaignId);
        if (msg.sender != campaign.beneficiary) revert NotBeneficiary();
        if (campaign.storedState != CampaignState.Active) revert FundsLocked();

        // A successful goal alone never authorizes a payment: every payout
        // requires an executed DAO decision.
        if (!campaign.earlyReleaseApproved) revert FundsLocked();

        uint256 amount = campaign.totalRaised;
        campaign.storedState = CampaignState.PaidOut;

        (bool sent,) = campaign.beneficiary.call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit FundsWithdrawn(campaignId, campaign.beneficiary, amount);
    }

    function refund(uint256 campaignId) external whenNotPaused nonReentrant {
        Campaign storage campaign = _campaign(campaignId);
        // A frozen campaign is refundable too: the freeze protects contributors,
        // so it must not trap their ETH with no exit.
        CampaignState currentState = campaignStatus(campaignId);
        if (
            currentState != CampaignState.Failed && currentState != CampaignState.Cancelled
                && currentState != CampaignState.Frozen
        ) {
            revert RefundUnavailable();
        }

        uint256 amount = contributions[campaignId][msg.sender];
        if (amount == 0) revert NothingToRefund();

        contributions[campaignId][msg.sender] = 0;
        campaign.totalRaised -= uint128(amount);

        // The associated tokens stay locked until payout and are burned exactly.
        uint256 burnedTokens = governanceToken.burnVotingPower(msg.sender, amount * tokensPerEth);

        (bool sent,) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit Refunded(campaignId, msg.sender, amount, burnedTokens);
    }

    function approveEarlyRelease(uint256 campaignId) external override onlyRole(GOVERNANCE_ROLE) {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.storedState != CampaignState.Active) revert CampaignNotActive();
        if (block.timestamp >= campaign.deadline) revert CampaignClosed();
        if (campaign.totalRaised >= campaign.goal) revert CampaignClosed();
        campaign.earlyReleaseApproved = true;
        emit EarlyReleaseApproved(campaignId);
    }

    function approveRelease(uint256 campaignId) external override onlyRole(GOVERNANCE_ROLE) {
        if (campaignStatus(campaignId) != CampaignState.Successful) revert FundsLocked();
        _campaigns[campaignId].earlyReleaseApproved = true;
        emit ReleaseApproved(campaignId);
    }

    /// @notice Anyone can unlock a contributor's tokens after irrevocable payout.
    /// No contributor loop is needed in withdrawFunds.
    function releaseContributionTokens(uint256 campaignId, address contributor) external {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.storedState != CampaignState.PaidOut) revert FundsLocked();
        if (votingTokensReleased[campaignId][contributor]) revert TokensAlreadyReleased();
        uint256 amount = contributions[campaignId][contributor];
        if (amount == 0) revert NothingToRefund();
        votingTokensReleased[campaignId][contributor] = true;
        governanceToken.releaseVotingPower(contributor, amount * tokensPerEth);
    }

    function freezeCampaign(uint256 campaignId) external override onlyRole(GOVERNANCE_ROLE) {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.storedState != CampaignState.Active) revert CampaignNotActive();
        campaign.storedState = CampaignState.Frozen;
        emit CampaignFrozen(campaignId);
    }

    function cancelCampaign(uint256 campaignId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.storedState != CampaignState.Active) revert CampaignNotActive();
        campaign.storedState = CampaignState.Cancelled;
        emit CampaignCancelled(campaignId);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        Campaign storage campaign = _campaign(campaignId);
        return campaign;
    }

    function campaignStatus(uint256 campaignId) public view returns (CampaignState) {
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.storedState != CampaignState.Active) return campaign.storedState;
        if (campaign.earlyReleaseApproved) return CampaignState.Successful;
        if (campaign.totalRaised >= campaign.goal) return CampaignState.Successful;
        if (block.timestamp < campaign.deadline) return CampaignState.Active;
        return CampaignState.Failed;
    }

    function _campaign(uint256 campaignId) private view returns (Campaign storage campaign) {
        if (campaignId >= nextCampaignId) revert CampaignNotFound();
        campaign = _campaigns[campaignId];
    }
}
