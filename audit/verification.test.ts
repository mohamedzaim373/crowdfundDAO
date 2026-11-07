import { expect } from "chai";
import hre from "hardhat";
import { executeReadyProposals } from "../scripts/keeper.mjs";

const { ethers, networkHelpers: h } = await hre.network.create();
const eth = ethers.parseEther;

async function fixture() {
  const [admin, alice, bob, beneficiary, stranger] = await ethers.getSigners();
  const token = await ethers.deployContract("CFDToken", [admin.address]);
  const core = await ethers.deployContract("CrowdfundingCore", [await token.getAddress(), admin.address, 100]);
  const gov = await ethers.deployContract("CampaignGovernance", [await token.getAddress(), await core.getAddress(), 5, 2, 5000]);
  const treasury = await ethers.deployContract("MultiSigTreasury", [[admin.address, alice.address, bob.address], eth("1")]);
  await token.grantRole(await token.MINTER_ROLE(), await core.getAddress());
  await token.grantRole(await token.BURNER_ROLE(), await core.getAddress());
  await core.grantRole(await core.GOVERNANCE_ROLE(), await gov.getAddress());
  const deadline = BigInt(await h.time.latest()) + 3600n;
  await core.createCampaign(eth("2"), deadline, beneficiary.address, "ipfs://bafkreih33xpwo4wnh7u6c74zvcltj3h3giygigxlmkheqmc4mtmprxmtwy");
  return { admin, alice, bob, beneficiary, stranger, token, core, gov, treasury, deadline };
}

async function proposal(f: Awaited<ReturnType<typeof fixture>>, action = 0) {
  await f.core.connect(f.alice).contribute(0, { value: eth("1") });
  await f.gov.connect(f.alice).createProposal(0, action, "Verification complementaire");
}

describe("Verification complementaire - controles attendus", function () {
  it("executes early release then pays the beneficiary exactly once", async () => {
    const f = await h.loadFixture(fixture);
    await proposal(f);
    await f.gov.connect(f.alice).castVote(1, true);
    await expect(f.gov.execute(1)).to.be.revertedWithCustomError(f.gov, "ExecutionNotReady");
    await h.mine(7);
    await f.gov.execute(1);
    expect((await f.core.getCampaign(0)).earlyReleaseApproved).to.equal(true);
    await expect(() => f.core.connect(f.beneficiary).withdrawFunds(0)).to.changeEtherBalances(ethers, [f.core, f.beneficiary], [-eth("1"), eth("1")]);
    await expect(f.core.connect(f.beneficiary).withdrawFunds(0)).to.be.revertedWithCustomError(f.core, "FundsLocked");
    await expect(f.gov.execute(1)).to.be.revertedWithCustomError(f.gov, "ExecutionNotReady");
  });

  it("rejects a second vote by the same address", async () => {
    const f = await h.loadFixture(fixture);
    await proposal(f);
    await f.gov.connect(f.alice).castVote(1, true);
    await expect(f.gov.connect(f.alice).castVote(1, true)).to.be.revertedWithCustomError(f.gov, "AlreadyVoted");
  });

  it("rejects execution without quorum", async () => {
    const f = await h.loadFixture(fixture);
    await proposal(f);
    await h.mine(8);
    expect(await f.gov.state(1)).to.equal(1n);
    await expect(f.gov.execute(1)).to.be.revertedWithCustomError(f.gov, "ProposalDefeated");
  });

  it("rejects a proposal with a majority against", async () => {
    const f = await h.loadFixture(fixture);
    await proposal(f);
    await f.gov.connect(f.alice).castVote(1, false);
    await h.mine(8);
    await expect(f.gov.execute(1)).to.be.revertedWithCustomError(f.gov, "ProposalDefeated");
  });

  it("rejects unauthorized administrative operations and token minting", async () => {
    const f = await h.loadFixture(fixture);
    for (const action of [() => f.core.connect(f.stranger).pause(), () => f.core.connect(f.stranger).unpause(), () => f.core.connect(f.stranger).cancelCampaign(0), () => f.core.connect(f.stranger).freezeCampaign(0), () => f.core.connect(f.stranger).approveEarlyRelease(0), () => f.core.connect(f.stranger).approveRelease(0)]) {
      await expect(action()).to.be.revertedWithCustomError(f.core, "AccessControlUnauthorizedAccount");
    }
    await expect(f.token.connect(f.stranger).mint(f.stranger.address, eth("100"))).to.be.revertedWithCustomError(f.token, "AccessControlUnauthorizedAccount");
    await expect(f.token.connect(f.stranger).burnVotingPower(f.alice.address, 1)).to.be.revertedWithCustomError(f.token, "AccessControlUnauthorizedAccount");
  });

  it("blocks withdrawal and refund while paused, resumes and prevents double refund", async () => {
    const f = await h.loadFixture(fixture);
    await f.core.connect(f.alice).contribute(0, { value: eth("0.5") });
    await f.core.cancelCampaign(0);
    await f.core.pause();
    await expect(f.core.connect(f.alice).refund(0)).to.be.revertedWithCustomError(f.core, "EnforcedPause");
    await expect(f.core.connect(f.beneficiary).withdrawFunds(0)).to.be.revertedWithCustomError(f.core, "EnforcedPause");
    await f.core.unpause();
    await expect(() => f.core.connect(f.alice).refund(0)).to.changeEtherBalances(ethers, [f.core, f.alice], [-eth("0.5"), eth("0.5")]);
    await expect(f.core.connect(f.alice).refund(0)).to.be.revertedWithCustomError(f.core, "NothingToRefund");
  });

  it("rejects zero contributions and contributions at deadline", async () => {
    const f = await h.loadFixture(fixture);
    await expect(f.core.connect(f.alice).contribute(0)).to.be.revertedWithCustomError(f.core, "ZeroContribution");
    await h.time.increaseTo(f.deadline);
    await expect(f.core.connect(f.alice).contribute(0, { value: eth("1") })).to.be.revertedWithCustomError(f.core, "CampaignClosed");
  });

  it("enforces treasury membership, revocation, exact threshold and single execution", async () => {
    const f = await h.loadFixture(fixture);
    await f.admin.sendTransaction({ to: await f.treasury.getAddress(), value: eth("3") });
    await expect(f.treasury.connect(f.stranger).submitTransaction(f.stranger.address, 1, "0x")).to.be.revertedWithCustomError(f.treasury, "NotOwner");
    expect(await f.treasury.requiredConfirmations(eth("1"), false)).to.equal(1n);
    expect(await f.treasury.requiredConfirmations(eth("1") + 1n, false)).to.equal(2n);
    await f.treasury.submitTransaction(f.stranger.address, eth("2"), "0x");
    await expect(f.treasury.confirmTransaction(0)).to.be.revertedWithCustomError(f.treasury, "AlreadyConfirmed");
    await f.treasury.connect(f.alice).confirmTransaction(0);
    await f.treasury.connect(f.alice).revokeConfirmation(0);
    await expect(f.treasury.executeTransaction(0)).to.be.revertedWithCustomError(f.treasury, "InsufficientConfirmations");
    await f.treasury.connect(f.bob).confirmTransaction(0);
    await f.treasury.executeTransaction(0);
    await expect(f.treasury.executeTransaction(0)).to.be.revertedWithCustomError(f.treasury, "AlreadyExecuted");
  });
});

describe("Regressions des defauts corriges", function () {
  it("requires governance approval even for a successful campaign", async () => {
    const f = await h.loadFixture(fixture);
    await f.core.connect(f.alice).contribute(0, { value: eth("2") });
    await h.time.increaseTo(f.deadline);
    expect(await f.gov.proposalCount()).to.equal(0n);
    await expect(f.core.connect(f.beneficiary).withdrawFunds(0)).to.be.revertedWithCustomError(f.core, "FundsLocked");
  });

  it("prevents repeated refundable contributions from accumulating CFD", async () => {
    const f = await h.loadFixture(fixture);
    for (let i = 0; i < 3; i++) {
      if (i > 0) await f.core.createCampaign(eth("2"), BigInt(await h.time.latest()) + 3600n, f.beneficiary.address, "ipfs://test");
      await f.core.connect(f.alice).contribute(i, { value: eth("1") });
      await expect(f.token.connect(f.alice).transfer(f.bob.address, eth("100")))
        .to.be.revertedWithCustomError(f.token, "ContributionTokensLocked");
      await f.token.connect(f.alice).approve(f.bob.address, eth("100"));
      await expect(f.token.connect(f.bob).transferFrom(f.alice.address, f.bob.address, eth("100")))
        .to.be.revertedWithCustomError(f.token, "ContributionTokensLocked");
      await h.time.increaseTo((await f.core.getCampaign(i)).deadline);
      await f.core.connect(f.alice).refund(i);
    }
    expect(await ethers.provider.getBalance(await f.core.getAddress())).to.equal(0n);
    expect(await f.token.totalSupply()).to.equal(0n);
    expect(await f.token.getVotes(f.bob.address)).to.equal(0n);
  });

  it("allows exact refund burning during token pause while the Core is active", async () => {
    const f = await h.loadFixture(fixture);
    await f.core.connect(f.alice).contribute(0, { value: eth("1") });
    await f.core.cancelCampaign(0);
    expect(await f.core.paused()).to.equal(false);
    await f.token.pause();
    await f.core.connect(f.alice).refund(0);
    expect(await f.token.totalSupply()).to.equal(0n);
    expect(await f.token.lockedBalance(f.alice.address)).to.equal(0n);
  });

  it("unlocks only paid contributions, once, without unlocking another campaign", async () => {
    const f = await h.loadFixture(fixture);
    await proposal(f);
    await f.core.createCampaign(eth("2"), f.deadline, f.beneficiary.address, "ipfs://test");
    await f.core.connect(f.alice).contribute(1, { value: eth("1") });
    await expect(f.core.releaseContributionTokens(0, f.alice.address)).to.be.revertedWithCustomError(f.core, "FundsLocked");
    await f.gov.connect(f.alice).castVote(1, true);
    await h.mine(8);
    await f.gov.execute(1);
    await f.core.connect(f.beneficiary).withdrawFunds(0);
    await f.core.releaseContributionTokens(0, f.alice.address);
    await f.token.connect(f.alice).transfer(f.bob.address, eth("100"));
    expect(await f.token.lockedBalance(f.alice.address)).to.equal(eth("100"));
    await expect(f.core.releaseContributionTokens(0, f.alice.address)).to.be.revertedWithCustomError(f.core, "TokensAlreadyReleased");
    await expect(f.token.connect(f.alice).transfer(f.bob.address, 1)).to.be.revertedWithCustomError(f.token, "ContributionTokensLocked");
    await h.time.increaseTo(f.deadline);
    await f.core.connect(f.alice).refund(1);
    expect(await f.token.totalSupply()).to.equal(eth("100"));
  });

  it("rejects early release after a campaign failed", async () => {
    const f = await h.loadFixture(fixture);
    await proposal(f);
    await f.gov.connect(f.alice).castVote(1, true);
    await h.time.increaseTo(f.deadline);
    await h.mine(8);
    await expect(f.gov.execute(1)).to.be.revertedWithCustomError(f.core, "CampaignClosed");
    await f.core.connect(f.alice).refund(0);
  });

  it("never executes during the voting window even with zero execution delay", async () => {
    const f = await h.loadFixture(fixture);
    const gov = await ethers.deployContract("CampaignGovernance", [await f.token.getAddress(), await f.core.getAddress(), 3, 0, 5000]);
    await f.core.grantRole(await f.core.GOVERNANCE_ROLE(), await gov.getAddress());
    await f.core.connect(f.alice).contribute(0, { value: eth("1") });
    await gov.connect(f.alice).createProposal(0, 0, "zero-delay boundary");
    await gov.connect(f.alice).castVote(1, true);
    await h.mine(2);
    expect(await gov.state(1)).to.equal(0n);
    await expect(gov.execute.staticCall(1)).to.be.revertedWithCustomError(gov, "ExecutionNotReady");
    await gov.execute(1);
    expect(await gov.state(1)).to.equal(4n);
  });

  it("automatically executes approved decisions through the local keeper", async () => {
    const f = await h.loadFixture(fixture);
    await proposal(f);
    await f.gov.connect(f.alice).castVote(1, true);
    await h.mine(8);
    await executeReadyProposals({ getNetwork: () => ethers.provider.getNetwork(), getSigner: async () => f.admin }, { chainId: "31337", contracts: { CampaignGovernance: await f.gov.getAddress() } });
    expect(await f.gov.state(1)).to.equal(4n);
    expect((await f.core.getCampaign(0)).earlyReleaseApproved).to.equal(true);
  });

  it("refuses to use the local keeper on a public network", async () => {
    try {
      await executeReadyProposals({ getNetwork: async () => ({ chainId: 1n }) }, { chainId: "1" });
      expect.fail("public network must be refused");
    } catch (error) {
      expect((error as Error).message).to.include("Hardhat Local");
    }
  });
});
