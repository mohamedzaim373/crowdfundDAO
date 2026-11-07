import { expect } from "chai";
import { BaseContract, ContractRunner, parseEther, ZeroAddress, ZeroHash } from "ethers";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();

function connect<T extends BaseContract>(contract: T, runner: ContractRunner): T {
  return contract.connect(runner) as T;
}

async function deploySystemFixture() {
  const [admin, alice, bob, charlie, beneficiary] = await ethers.getSigners();

  const token = await ethers.deployContract("CFDToken", [admin.address]);
  const core = await ethers.deployContract("CrowdfundingCore", [
    await token.getAddress(),
    admin.address,
    100,
  ]);
  const governance = await ethers.deployContract("CampaignGovernance", [
    await token.getAddress(),
    await core.getAddress(),
    5,
    2,
    5_000,
  ]);
  const treasury = await ethers.deployContract("MultiSigTreasury", [
    [admin.address, alice.address, bob.address],
    parseEther("1"),
  ]);

  await token.grantRole(await token.MINTER_ROLE(), await core.getAddress());
  await token.grantRole(await token.BURNER_ROLE(), await core.getAddress());
  await core.grantRole(await core.GOVERNANCE_ROLE(), await governance.getAddress());

  return { admin, alice, bob, charlie, beneficiary, token, core, governance, treasury };
}

async function createCampaign(
  core: Awaited<ReturnType<typeof deploySystemFixture>>["core"],
  beneficiary: string,
  goal = parseEther("2"),
  duration = 3_600n,
) {
  const now = BigInt(await networkHelpers.time.latest());
  const campaignId = await core.nextCampaignId();
  await core.createCampaign(goal, now + duration, beneficiary, "ipfs://bafy-demo");
  return { campaignId, deadline: now + duration };
}

describe("Crowdfund DAO", function () {
  describe("campaign lifecycle and CFD token", function () {
    it("creates a campaign, escrows ETH, and mints governance power", async function () {
      const { core, token, alice, beneficiary } = await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId } = await createCampaign(core, beneficiary.address);

      await expect(connect(core, alice).contribute(campaignId, { value: parseEther("1") }))
        .to.emit(core, "ContributionReceived")
        .withArgs(campaignId, alice.address, parseEther("1"), parseEther("100"));

      const campaign = await core.getCampaign(campaignId);
      expect(campaign.totalRaised).to.equal(parseEther("1"));
      expect(await token.balanceOf(alice.address)).to.equal(parseEther("100"));
      expect(await ethers.provider.getBalance(await core.getAddress())).to.equal(parseEther("1"));
    });

    it("closes contributions immediately at the goal and prevents overfunding", async function () {
      const { core, alice, bob, beneficiary } = await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId } = await createCampaign(core, beneficiary.address, parseEther("1"));

      await connect(core, alice).contribute(campaignId, { value: parseEther("0.6") });
      await expect(connect(core, bob).contribute(campaignId, { value: parseEther("0.5") }))
        .to.be.revertedWithCustomError(core, "ContributionExceedsGoal")
        .withArgs(parseEther("0.4"));

      await expect(connect(core, bob).contribute(campaignId, { value: parseEther("0.4") }))
        .to.emit(core, "CampaignGoalReached")
        .withArgs(campaignId, parseEther("1"));
      expect(await core.campaignStatus(campaignId)).to.equal(1n);
      await expect(
        connect(core, bob).contribute(campaignId, { value: parseEther("0.001") }),
      ).to.be.revertedWithCustomError(core, "CampaignClosed");
    });

    it("allows a failed campaign refund and burns the corresponding CFD", async function () {
      const { core, token, alice, beneficiary } = await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId, deadline } = await createCampaign(core, beneficiary.address);
      await connect(core, alice).contribute(campaignId, { value: parseEther("0.5") });

      await networkHelpers.time.increaseTo(deadline + 1n);
      expect(await core.campaignStatus(campaignId)).to.equal(2n);

      await expect(connect(core, alice).refund(campaignId))
        .to.emit(core, "Refunded")
        .withArgs(campaignId, alice.address, parseEther("0.5"), parseEther("50"));
      expect(await token.balanceOf(alice.address)).to.equal(0n);
      expect(await core.contributions(campaignId, alice.address)).to.equal(0n);
    });

    it("blocks transfer of refundable CFD and burns the full balance on refund", async function () {
      const { core, token, alice, bob, beneficiary } = await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId, deadline } = await createCampaign(core, beneficiary.address);
      await connect(core, alice).contribute(campaignId, { value: parseEther("0.5") });

      // The refund liability locks the associated CFD before any transfer.
      await expect(connect(token, alice).transfer(bob.address, parseEther("50")))
        .to.be.revertedWithCustomError(token, "ContributionTokensLocked");
      await networkHelpers.time.increaseTo(deadline);

      await expect(connect(core, alice).refund(campaignId))
        .to.emit(core, "Refunded")
        .withArgs(campaignId, alice.address, parseEther("0.5"), parseEther("50"));
      expect(await token.totalSupply()).to.equal(0n);
      expect(await token.lockedBalance(alice.address)).to.equal(0n);
    });

    it("releases a successful campaign only to its beneficiary", async function () {
      const { core, token, governance, alice, bob, beneficiary } = await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId, deadline } = await createCampaign(core, beneficiary.address, parseEther("1"));
      await connect(core, alice).contribute(campaignId, { value: parseEther("1") });
      await networkHelpers.time.increaseTo(deadline + 1n);

      await expect(connect(core, beneficiary).withdrawFunds(campaignId))
        .to.be.revertedWithCustomError(core, "FundsLocked");
      await connect(governance, alice).createProposal(campaignId, 2, "ipfs://bafkreiapprovepayoutaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await connect(governance, alice).castVote(1, true);
      await networkHelpers.mine(8);
      await governance.execute(1);

      await expect(connect(core, bob).withdrawFunds(campaignId)).to.be.revertedWithCustomError(
        core,
        "NotBeneficiary",
      );
      await expect(connect(core, beneficiary).withdrawFunds(campaignId))
        .to.emit(core, "FundsWithdrawn")
        .withArgs(campaignId, beneficiary.address, parseEther("1"));
      expect(await core.campaignStatus(campaignId)).to.equal(5n);
    });

    it("stops contributions and withdrawals while the circuit breaker is active", async function () {
      const { core, admin, alice, beneficiary } = await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId } = await createCampaign(core, beneficiary.address);
      await connect(core, admin).pause();

      await expect(
        connect(core, alice).contribute(campaignId, { value: parseEther("0.1") }),
      ).to.be.revertedWithCustomError(core, "EnforcedPause");
      await connect(core, admin).unpause();
      await expect(connect(core, alice).contribute(campaignId, { value: parseEther("0.1") })).to.emit(
        core,
        "ContributionReceived",
      );
    });

    it("blocks a reentrant refund attempt", async function () {
      const { core, beneficiary } = await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId, deadline } = await createCampaign(
        core,
        beneficiary.address,
        parseEther("10"),
        100n,
      );
      const attacker = await ethers.deployContract("ReentrancyAttacker", [await core.getAddress()]);
      await attacker.contribute(campaignId, { value: parseEther("1") });
      await networkHelpers.time.increaseTo(deadline + 1n);

      await attacker.attackRefund(campaignId);
      expect(await attacker.reentryBlocked()).to.equal(true);
      expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(parseEther("1"));
      expect(await ethers.provider.getBalance(await core.getAddress())).to.equal(0n);
    });

    it("runs a randomized contribution invariant scenario", async function () {
      const { core, token, alice, bob, charlie, beneficiary } =
        await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId } = await createCampaign(core, beneficiary.address, parseEther("50"));
      const contributors = [alice, bob, charlie];
      const expected = new Map<string, bigint>();
      let total = 0n;

      // Deterministic pseudo-random inputs make this fuzz-style invariant test reproducible.
      let seed = 0x5eedn;
      for (let index = 0; index < 18; index += 1) {
        seed = (seed * 1_103_515_245n + 12_345n) % 2n ** 31n;
        const amount = ((seed % 90n) + 10n) * 10n ** 15n;
        const signer = contributors[index % contributors.length];
        await connect(core, signer).contribute(campaignId, { value: amount });
        expected.set(signer.address, (expected.get(signer.address) ?? 0n) + amount);
        total += amount;
      }

      const campaign = await core.getCampaign(campaignId);
      expect(campaign.totalRaised).to.equal(total);
      for (const contributor of contributors) {
        const contributed = expected.get(contributor.address) ?? 0n;
        expect(await core.contributions(campaignId, contributor.address)).to.equal(contributed);
        expect(await token.balanceOf(contributor.address)).to.equal(contributed * 100n);
      }
    });
  });

  describe("snapshot governance", function () {
    it("requires more than half of the snapshotted CFD supply to vote in favour", async function () {
      const { core, token, governance, admin, alice, bob, charlie, beneficiary } =
        await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId } = await createCampaign(core, beneficiary.address, parseEther("10"));
      const contributors = [admin, alice, bob, charlie, beneficiary];

      for (const contributor of contributors) {
        await connect(core, contributor).contribute(campaignId, { value: parseEther("1") });
      }
      await networkHelpers.mine(1);

      // Three wallets participate (60% quorum), but only two support the
      // proposal (40% of the total supply): a simple majority of participants
      // is intentionally insufficient.
      await connect(governance, alice).createProposal(
        campaignId,
        1,
        "ipfs://bafkreiabsolutemajorityaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      await connect(governance, alice).castVote(1, true);
      await connect(governance, bob).castVote(1, true);
      await connect(governance, charlie).castVote(1, false);
      await networkHelpers.mine(8);
      expect(await governance.state(1)).to.equal(1n);
      await expect(governance.execute(1)).to.be.revertedWithCustomError(
        governance,
        "ProposalDefeated",
      );

      // A fresh proposal receives three votes in favour (60% of all CFD) and
      // can therefore be executed.
      await connect(governance, alice).createProposal(
        campaignId,
        1,
        "ipfs://bafkreithreeoffiveaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      await connect(governance, alice).castVote(2, true);
      await connect(governance, bob).castVote(2, true);
      await connect(governance, charlie).castVote(2, true);
      await networkHelpers.mine(8);
      await expect(governance.execute(2)).to.emit(governance, "ProposalExecuted").withArgs(2);
      expect(await core.campaignStatus(campaignId)).to.equal(3n);
    });

    it("freezes a campaign after quorum, majority, and execution delay", async function () {
      const { core, token, governance, alice, bob, beneficiary } =
        await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId } = await createCampaign(core, beneficiary.address, parseEther("5"));

      await connect(core, alice).contribute(campaignId, { value: parseEther("1") });
      await connect(core, bob).contribute(campaignId, { value: parseEther("0.5") });
      await networkHelpers.mine(1);

      await connect(governance, alice).createProposal(campaignId, 1, "ipfs://bafkreifreezesuspiciousaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await connect(governance, alice).castVote(1, true);
      await connect(governance, bob).castVote(1, true);
      await networkHelpers.mine(6);

      await expect(governance.execute(1)).to.emit(governance, "ProposalExecuted").withArgs(1);
      expect(await core.campaignStatus(campaignId)).to.equal(3n);
      expect(await governance.state(1)).to.equal(4n);
    });

    it("lets contributors exit a frozen campaign instead of trapping their ETH", async function () {
      const { core, token, governance, alice, bob, beneficiary } =
        await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId } = await createCampaign(core, beneficiary.address, parseEther("5"));

      await connect(core, alice).contribute(campaignId, { value: parseEther("1") });
      await connect(core, bob).contribute(campaignId, { value: parseEther("0.5") });
      await networkHelpers.mine(1);

      await connect(governance, alice).createProposal(campaignId, 1, "ipfs://bafkreifreezesuspiciousaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await connect(governance, alice).castVote(1, true);
      await connect(governance, bob).castVote(1, true);
      await networkHelpers.mine(6);
      await governance.execute(1);
      expect(await core.campaignStatus(campaignId)).to.equal(3n);

      await expect(connect(core, alice).refund(campaignId))
        .to.emit(core, "Refunded")
        .withArgs(campaignId, alice.address, parseEther("1"), parseEther("100"));
      expect(await token.balanceOf(alice.address)).to.equal(0n);

      await connect(core, bob).refund(campaignId);
      expect(await ethers.provider.getBalance(await core.getAddress())).to.equal(0n);
    });

    it("uses historical voting power instead of a post-snapshot transfer", async function () {
      const { core, token, governance, alice, charlie, beneficiary } =
        await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId } = await createCampaign(core, beneficiary.address, parseEther("5"));
      await connect(core, alice).contribute(campaignId, { value: parseEther("1") });
      await networkHelpers.mine(1);

      await connect(governance, alice).createProposal(campaignId, 0, "ipfs://bafkreireleaseearlyaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await connect(governance, alice).castVote(1, true);
      await networkHelpers.mine(8);
      await governance.execute(1);
      await connect(core, beneficiary).withdrawFunds(campaignId);
      await core.releaseContributionTokens(campaignId, alice.address);

      // The first campaign is now paid and its CFD are transferable. A second
      // proposal freezes its snapshot before a transfer to another holder.
      const second = await createCampaign(core, beneficiary.address);
      await connect(governance, alice).createProposal(second.campaignId, 1, "ipfs://bafkreisnapshotcheckaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await connect(token, alice).transfer(charlie.address, parseEther("100"));

      await expect(connect(governance, charlie).castVote(2, true)).to.be.revertedWithCustomError(
        governance,
        "NoVotingPower",
      );
      await expect(connect(governance, alice).castVote(2, true))
        .to.emit(governance, "VoteCast")
        .withArgs(2, alice.address, true, parseEther("100"));
    });

    it("rejects a proposal targeting a campaign that does not exist", async function () {
      const { core, token, governance, alice, beneficiary } =
        await networkHelpers.loadFixture(deploySystemFixture);
      await createCampaign(core, beneficiary.address);
      await connect(core, alice).contribute(0, { value: parseEther("1") });

      await expect(
        connect(governance, alice).createProposal(7, 1, "ipfs://bafkreiinexistantaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      ).to.be.revertedWithCustomError(governance, "CampaignNotFound");
    });

    it("rejects a proposal whose motive is not published off-chain", async function () {
      // Le motif ne vivant plus on-chain, une empreinte vide priverait les
      // votants de toute justification à lire avant de se prononcer.
      const { core, token, governance, alice, beneficiary } =
        await networkHelpers.loadFixture(deploySystemFixture);
      await createCampaign(core, beneficiary.address);
      await connect(core, alice).contribute(0, { value: parseEther("1") });

      await expect(
        connect(governance, alice).createProposal(0, 1, ""),
      ).to.be.revertedWithCustomError(governance, "EmptyDescriptionHash");
    });

    it("rejects proposals from accounts holding no CFD", async function () {
      const { core, governance, alice, beneficiary } =
        await networkHelpers.loadFixture(deploySystemFixture);
      await createCampaign(core, beneficiary.address);

      await expect(
        connect(governance, alice).createProposal(0, 0, "ipfs://bafkreinostakeaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      ).to.be.revertedWithCustomError(governance, "NoVotingPower");
    });
  });

  // Le cahier des charges impose un vote « pondéré par solde de CFD ». Le
  // pouvoir de vote doit donc valoir le solde en permanence, sans que le
  // détenteur ait à l'activer et sans qu'il puisse le céder séparément.
  describe("voting weight equals the CFD balance", function () {
    it("gives immediate voting power on contribution, with no prior action", async function () {
      const { core, token, alice, beneficiary } = await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId } = await createCampaign(core, beneficiary.address, parseEther("5"));

      await connect(core, alice).contribute(campaignId, { value: parseEther("1") });

      expect(await token.balanceOf(alice.address)).to.equal(parseEther("100"));
      expect(await token.getVotes(alice.address)).to.equal(parseEther("100"));
      expect(await token.delegates(alice.address)).to.equal(alice.address);
    });

    it("moves the voting power with the tokens on transfer", async function () {
      const { core, token, alice, charlie, beneficiary, governance } =
        await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId } = await createCampaign(core, beneficiary.address, parseEther("5"));
      await connect(core, alice).contribute(campaignId, { value: parseEther("1") });

      // Les CFD d'une contribution remboursable sont verrouillés : on paie la
      // campagne pour les libérer avant de tester le transfert.
      await connect(governance, alice).createProposal(campaignId, 0, "ipfs://bafkreiweightfollowsaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await connect(governance, alice).castVote(1, true);
      await networkHelpers.mine(8);
      await governance.execute(1);
      await connect(core, beneficiary).withdrawFunds(campaignId);
      await core.releaseContributionTokens(campaignId, alice.address);

      await connect(token, alice).transfer(charlie.address, parseEther("40"));

      // Charlie n'a rien activé : la réception suffit à lui donner ses voix.
      expect(await token.getVotes(alice.address)).to.equal(parseEther("60"));
      expect(await token.getVotes(charlie.address)).to.equal(parseEther("40"));
      expect(await token.delegates(charlie.address)).to.equal(charlie.address);
    });

    it("refuses to transfer voting power away from the tokens", async function () {
      const { core, token, alice, bob, beneficiary } = await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId } = await createCampaign(core, beneficiary.address, parseEther("5"));
      await connect(core, alice).contribute(campaignId, { value: parseEther("1") });

      await expect(connect(token, alice).delegate(bob.address)).to.be.revertedWithCustomError(
        token,
        "DelegationDisabled",
      );
      await expect(connect(token, alice).delegate(alice.address)).to.be.revertedWithCustomError(
        token,
        "DelegationDisabled",
      );
      await expect(
        connect(token, alice).delegateBySig(bob.address, 0, 2n ** 32n, 27, ZeroHash, ZeroHash),
      ).to.be.revertedWithCustomError(token, "DelegationDisabled");
    });

    it("destroys the voting power along with the refunded CFD", async function () {
      const { core, token, alice, beneficiary } = await networkHelpers.loadFixture(deploySystemFixture);
      const { campaignId, deadline } = await createCampaign(core, beneficiary.address, parseEther("5"));
      await connect(core, alice).contribute(campaignId, { value: parseEther("1") });
      await networkHelpers.time.increaseTo(deadline + 1n);

      await connect(core, alice).refund(campaignId);

      const refundBlock = await ethers.provider.getBlockNumber();
      await networkHelpers.mine(1);

      expect(await token.balanceOf(alice.address)).to.equal(0n);
      expect(await token.getVotes(alice.address)).to.equal(0n);
      // L'offre figée au bloc du remboursement est nulle : aucune voix
      // orpheline ne subsiste pour un futur snapshot.
      expect(await token.getPastTotalSupply(refundBlock)).to.equal(0n);
    });
  });

  describe("2-of-3 multisignature treasury", function () {
    it("requires two owners for withdrawals above the threshold", async function () {
      const { treasury, admin, alice, charlie } = await networkHelpers.loadFixture(deploySystemFixture);
      await admin.sendTransaction({ to: await treasury.getAddress(), value: parseEther("3") });
      await connect(treasury, admin).submitTransaction(charlie.address, parseEther("2"), "0x");

      await expect(connect(treasury, admin).executeTransaction(0)).to.be.revertedWithCustomError(
        treasury,
        "InsufficientConfirmations",
      );
      await connect(treasury, alice).confirmTransaction(0);
      await expect(() => connect(treasury, admin).executeTransaction(0)).to.changeEtherBalances(
        ethers,
        [treasury, charlie],
        [-parseEther("2"), parseEther("2")],
      );
    });

    it("allows one owner to execute a withdrawal at or below the threshold", async function () {
      const { treasury, admin, charlie } = await networkHelpers.loadFixture(deploySystemFixture);
      await admin.sendTransaction({ to: await treasury.getAddress(), value: parseEther("1") });
      await connect(treasury, admin).submitTransaction(charlie.address, parseEther("0.5"), "0x");
      await expect(connect(treasury, admin).executeTransaction(0)).to.emit(
        treasury,
        "TransactionExecuted",
      );
    });

    it("requires two owners for a data-only call that drains assets", async function () {
      const { treasury, token, admin, alice, charlie } = await networkHelpers.loadFixture(deploySystemFixture);
      await token.grantRole(await token.MINTER_ROLE(), admin.address);
      await token.mint(await treasury.getAddress(), parseEther("1000"));
      await token.grantRole(await token.BURNER_ROLE(), admin.address);
      await token.releaseVotingPower(await treasury.getAddress(), parseEther("1000"));

      // Value is zero, so a value-only threshold would wave this through, yet the
      // call hands every CFD held by the treasury to a single owner's address.
      const data = token.interface.encodeFunctionData("transfer", [
        charlie.address,
        parseEther("1000"),
      ]);
      await connect(treasury, admin).submitTransaction(await token.getAddress(), 0, data);

      await expect(connect(treasury, admin).executeTransaction(0)).to.be.revertedWithCustomError(
        treasury,
        "InsufficientConfirmations",
      );

      await connect(treasury, alice).confirmTransaction(0);
      await connect(treasury, admin).executeTransaction(0);
      expect(await token.balanceOf(charlie.address)).to.equal(parseEther("1000"));
    });

    it("rejects duplicate or zero-address owners", async function () {
      const { admin, alice } = await networkHelpers.loadFixture(deploySystemFixture);
      const treasuryFactory = await ethers.getContractFactory("MultiSigTreasury");
      await expect(
        ethers.deployContract("MultiSigTreasury", [
          [admin.address, alice.address, ZeroAddress],
          parseEther("1"),
        ]),
      ).to.be.revertedWithCustomError(treasuryFactory, "InvalidOwners");
    });
  });
});
