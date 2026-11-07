// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICrowdfundingGovernance} from "./interfaces/ICrowdfundingGovernance.sol";

/// @title Snapshot-based governance for crowdfunding campaign decisions
/// @notice Voting weight and total supply are fixed before proposal creation.
///         A proposal needs both the configured participation quorum and an
///         absolute majority of the snapshotted CFD supply in favour.
contract CampaignGovernance is ReentrancyGuard {
    enum ProposalAction {
        ApproveEarlyRelease,
        FreezeCampaign,
        ApproveRelease
    }

    enum ProposalState {
        Active,
        Defeated,
        Succeeded,
        Queued,
        Executed
    }

    struct Proposal {
        address proposer;
        uint64 snapshotBlock;
        uint64 deadlineBlock;
        uint64 executeAfterBlock;
        uint64 campaignId;
        uint128 votesFor;
        uint128 votesAgainst;
        ProposalAction action;
        bool executed;
        /// @dev URI IPFS (`ipfs://<CID>`) du motif de la proposition. Comme pour
        ///      les campagnes, seule l'empreinte du texte est conservée
        ///      on-chain : le contenu lisible vit hors-chaîne, et toute
        ///      réécriture ultérieure changerait le CID.
        string descriptionHash;
    }

    IVotes public immutable governanceToken;
    ICrowdfundingGovernance public immutable crowdfundingCore;
    uint64 public immutable votingPeriodBlocks;
    uint64 public immutable executionDelayBlocks;
    uint16 public immutable quorumBps;
    uint256 public proposalCount;

    mapping(uint256 proposalId => Proposal proposal) private _proposals;
    mapping(uint256 proposalId => mapping(address voter => bool voted)) public hasVoted;

    error ZeroAddress();
    error InvalidVotingPeriod();
    error InvalidQuorum();
    error NoVotingPower();
    error CampaignNotFound();
    error ProposalNotFound();
    error VotingClosed();
    error AlreadyVoted();
    error VoteWeightOverflow();
    error ExecutionNotReady();
    error ProposalDefeated();
    error EmptyDescriptionHash();

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        uint256 indexed campaignId,
        ProposalAction action,
        uint256 snapshotBlock,
        uint256 deadlineBlock,
        uint256 executeAfterBlock,
        string descriptionHash
    );
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId);

    constructor(
        address tokenAddress,
        address coreAddress,
        uint64 votingPeriod,
        uint64 executionDelay,
        uint16 quorumBasisPoints
    ) {
        if (tokenAddress == address(0) || coreAddress == address(0)) revert ZeroAddress();
        if (votingPeriod == 0) revert InvalidVotingPeriod();
        if (quorumBasisPoints == 0 || quorumBasisPoints > 10_000) revert InvalidQuorum();

        governanceToken = IVotes(tokenAddress);
        crowdfundingCore = ICrowdfundingGovernance(coreAddress);
        votingPeriodBlocks = votingPeriod;
        executionDelayBlocks = executionDelay;
        quorumBps = quorumBasisPoints;
    }

    function createProposal(uint64 campaignId, ProposalAction action, string calldata descriptionHash)
        external
        returns (uint256 proposalId)
    {
        // Without this guard a vote can run its full course on a campaign that
        // does not exist, only to revert at execution with the outcome lost.
        if (campaignId >= crowdfundingCore.nextCampaignId()) revert CampaignNotFound();
        // Le motif n'étant plus stocké on-chain, une empreinte vide rendrait la
        // proposition impossible à justifier : les votants n'auraient rien à lire.
        if (bytes(descriptionHash).length == 0) revert EmptyDescriptionHash();

        uint64 snapshot = uint64(block.number - 1);
        if (governanceToken.getPastVotes(msg.sender, snapshot) == 0) revert NoVotingPower();

        proposalId = ++proposalCount;
        uint64 deadline = uint64(block.number) + votingPeriodBlocks;
        uint64 executeAfter = deadline + executionDelayBlocks + 1;
        _proposals[proposalId] = Proposal({
            proposer: msg.sender,
            snapshotBlock: snapshot,
            deadlineBlock: deadline,
            executeAfterBlock: executeAfter,
            campaignId: campaignId,
            votesFor: 0,
            votesAgainst: 0,
            action: action,
            executed: false,
            descriptionHash: descriptionHash
        });

        emit ProposalCreated(
            proposalId,
            msg.sender,
            campaignId,
            action,
            snapshot,
            deadline,
            executeAfter,
            descriptionHash
        );
    }

    function castVote(uint256 proposalId, bool support) external {
        Proposal storage proposal = _proposal(proposalId);
        if (block.number > proposal.deadlineBlock || proposal.executed) revert VotingClosed();
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();

        uint256 weight = governanceToken.getPastVotes(msg.sender, proposal.snapshotBlock);
        if (weight == 0) revert NoVotingPower();
        if (weight > type(uint128).max) revert VoteWeightOverflow();

        hasVoted[proposalId][msg.sender] = true;
        if (support) {
            proposal.votesFor += uint128(weight);
        } else {
            proposal.votesAgainst += uint128(weight);
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    function execute(uint256 proposalId) external nonReentrant {
        Proposal storage proposal = _proposal(proposalId);
        if (block.number < proposal.executeAfterBlock || proposal.executed) revert ExecutionNotReady();
        if (!_proposalPassed(proposal)) revert ProposalDefeated();

        proposal.executed = true;
        if (proposal.action == ProposalAction.ApproveEarlyRelease) {
            crowdfundingCore.approveEarlyRelease(proposal.campaignId);
        } else if (proposal.action == ProposalAction.FreezeCampaign) {
            crowdfundingCore.freezeCampaign(proposal.campaignId);
        } else {
            crowdfundingCore.approveRelease(proposal.campaignId);
        }

        emit ProposalExecuted(proposalId);
    }

    function state(uint256 proposalId) external view returns (ProposalState) {
        Proposal storage proposal = _proposal(proposalId);
        if (proposal.executed) return ProposalState.Executed;
        if (block.number <= proposal.deadlineBlock) return ProposalState.Active;
        if (!_proposalPassed(proposal)) return ProposalState.Defeated;
        if (block.number < proposal.executeAfterBlock) return ProposalState.Succeeded;
        return ProposalState.Queued;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        Proposal storage proposal = _proposal(proposalId);
        return proposal;
    }

    function quorum(uint256 proposalId) public view returns (uint256) {
        Proposal storage proposal = _proposal(proposalId);
        return governanceToken.getPastTotalSupply(proposal.snapshotBlock) * quorumBps / 10_000;
    }

    /// @notice Minimum number of CFD votes in favour: strictly more than half
    ///         of the total supply at the proposal snapshot.
    function majorityThreshold(uint256 proposalId) public view returns (uint256) {
        Proposal storage proposal = _proposal(proposalId);
        return governanceToken.getPastTotalSupply(proposal.snapshotBlock) / 2 + 1;
    }

    function _proposalPassed(Proposal storage proposal) private view returns (bool) {
        uint256 totalVotes = uint256(proposal.votesFor) + proposal.votesAgainst;
        uint256 totalSupply = governanceToken.getPastTotalSupply(proposal.snapshotBlock);
        uint256 requiredQuorum = totalSupply * quorumBps / 10_000;
        // Abstentions do not become votes against, but they prevent a small
        // active minority from approving a decision for all CFD holders.
        return totalVotes >= requiredQuorum && proposal.votesFor > totalSupply / 2;
    }

    function _proposal(uint256 proposalId) private view returns (Proposal storage proposal) {
        if (proposalId == 0 || proposalId > proposalCount) revert ProposalNotFound();
        proposal = _proposals[proposalId];
    }
}
