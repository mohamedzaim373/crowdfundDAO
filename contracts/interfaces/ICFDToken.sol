// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ICFDToken {
    function mint(address to, uint256 amount) external;

    /// @notice Burns the exact locked contribution tokens, including while paused.
    function burnVotingPower(address from, uint256 amount) external returns (uint256 burned);

    function releaseVotingPower(address from, uint256 amount) external;
}
