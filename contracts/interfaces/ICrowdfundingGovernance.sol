// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ICrowdfundingGovernance {
    function nextCampaignId() external view returns (uint256);
    function approveEarlyRelease(uint256 campaignId) external;
    function approveRelease(uint256 campaignId) external;
    function freezeCampaign(uint256 campaignId) external;
}
