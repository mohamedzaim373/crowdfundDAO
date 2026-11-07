// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ICrowdfundingAttackTarget {
    function contribute(uint256 campaignId) external payable;
    function refund(uint256 campaignId) external;
}

/// @dev Test-only contract that attempts to reenter `refund` from its receive hook.
contract ReentrancyAttacker {
    ICrowdfundingAttackTarget public immutable target;
    uint256 public attackedCampaignId;
    bool public attackInProgress;
    bool public reentryBlocked;

    constructor(address targetAddress) {
        target = ICrowdfundingAttackTarget(targetAddress);
    }

    function contribute(uint256 campaignId) external payable {
        target.contribute{value: msg.value}(campaignId);
    }

    function attackRefund(uint256 campaignId) external {
        attackedCampaignId = campaignId;
        attackInProgress = true;
        target.refund(campaignId);
        attackInProgress = false;
    }

    receive() external payable {
        if (attackInProgress) {
            try target.refund(attackedCampaignId) {
                reentryBlocked = false;
            } catch {
                reentryBlocked = true;
            }
        }
    }
}
