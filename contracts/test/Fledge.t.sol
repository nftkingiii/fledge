// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Fledge} from "../src/Fledge.sol";

contract FledgeTest is Test {
    Fledge fledge;
    address operator = makeAddr("operator");
    address oga = makeAddr("oga");
    address boy = makeAddr("apprentice");
    address w1 = makeAddr("union");
    address w2 = makeAddr("uncle");
    address w3 = makeAddr("pastor");

    uint128 constant USD = 1e6;
    uint128 constant PROMISE = 2_000 * USD; // about N2.75m at N1,375/$
    uint64 start;
    uint64 end;

    function setUp() public {
        vm.warp(1_800_000_000);
        fledge = new Fledge(operator);
        start = uint64(block.timestamp);
        end = start + 4 * 365 days;
    }

    function _witnesses() internal view returns (address[] memory ws) {
        ws = new address[](3);
        ws[0] = w1;
        ws[1] = w2;
        ws[2] = w3;
    }

    function _active() internal returns (uint256 id) {
        vm.prank(oga);
        id = fledge.propose(boy, _witnesses(), 2, PROMISE, start, end, 16, "Auto spare parts, Nnewi");
        vm.prank(boy);
        fledge.accept(id);
    }

    function _credit(uint256 id, uint128 amount, string memory ref) internal {
        vm.prank(operator);
        fledge.credit(id, amount, ref);
    }

    function test_onlyApprenticeCanAccept() public {
        vm.prank(oga);
        uint256 id = fledge.propose(boy, _witnesses(), 2, PROMISE, start, end, 16, "Textiles");
        vm.prank(oga);
        vm.expectRevert(Fledge.NotParty.selector);
        fledge.accept(id);
        vm.prank(boy);
        fledge.accept(id);
        assertEq(uint8(fledge.getPromise(id).status), uint8(Fledge.Status.Active));
    }

    function test_quorumMustFitWitnesses() public {
        vm.prank(oga);
        vm.expectRevert(Fledge.BadInput.selector);
        fledge.propose(boy, _witnesses(), 4, PROMISE, start, end, 16, "x");
    }

    function test_onlyOperatorCredits_andRefsAreSingleUse() public {
        uint256 id = _active();
        vm.prank(oga);
        vm.expectRevert(Fledge.NotOperator.selector);
        fledge.credit(id, 100 * USD, "ref1");

        _credit(id, 125 * USD, "FLEDGE1I1");
        vm.prank(operator);
        vm.expectRevert(Fledge.RefReused.selector);
        fledge.credit(id, 125 * USD, "FLEDGE1I1");
        assertEq(fledge.getPromise(id).funded, 125 * USD);
    }

    function test_missedQuarterShowsArrears() public {
        uint256 id = _active();
        // 16 instalments over 4 years: one per quarter, 125 USD each.
        vm.warp(start + 3 * 91.25 days + 1);
        _credit(id, 125 * USD, "q1");
        _credit(id, 125 * USD, "q2");
        assertEq(fledge.dueByNow(id), 375 * USD);
        assertEq(fledge.arrears(id), 125 * USD);
    }

    function test_settlementCannotBeRaisedBeforeEnd() public {
        uint256 id = _active();
        _credit(id, 500 * USD, "a");
        vm.prank(boy);
        vm.expectRevert(Fledge.TooEarly.selector);
        fledge.proposeResolution(id, Fledge.Kind.Settle, 500 * USD, 0, 0, 0, 0, "early");
    }

    function test_ogaCannotCutThePromiseAlone() public {
        uint256 id = _active();
        vm.prank(oga);
        fledge.proposeResolution(id, Fledge.Kind.Reduce, 0, 0, 0, 800 * USD, 0, "business is slow");
        // Even with every witness behind him, the apprentice has not consented.
        vm.prank(w1);
        fledge.approveResolution(id);
        vm.prank(w2);
        fledge.approveResolution(id);
        vm.prank(w3);
        fledge.approveResolution(id);
        assertEq(fledge.getPromise(id).promised, PROMISE);
        assertTrue(fledge.getResolution(id).open);
    }

    function test_ogaHasNoWayToPullFundsBack() public {
        uint256 id = _active();
        _credit(id, 1_000 * USD, "a");
        // An Oga cannot raise an early exit to take back what he paid in.
        vm.prank(oga);
        vm.expectRevert(Fledge.NotParty.selector);
        fledge.proposeResolution(id, Fledge.Kind.EarlyExit, 0, 0, 1_000 * USD, 0, 0, "refund me");
        // And the operator cannot pay out what no resolution approved.
        vm.prank(operator);
        vm.expectRevert(Fledge.ExceedsHeld.selector);
        fledge.markPaid(id, 1 * USD, "send1");
    }

    function test_witnessesCanOnlyApproveOncePerRound() public {
        uint256 id = _active();
        vm.prank(oga);
        fledge.proposeResolution(id, Fledge.Kind.Reduce, 0, 0, 0, 100 * USD, 0, "x");
        vm.prank(w1);
        fledge.approveResolution(id);
        vm.prank(w1);
        vm.expectRevert(Fledge.AlreadyApproved.selector);
        fledge.approveResolution(id);
    }

    function test_partialSettlementWithRepaymentPlan() public {
        uint256 id = _active();
        _credit(id, 1_200 * USD, "a"); // 60% funded
        vm.warp(end + 1);

        uint64 newEnd = uint64(block.timestamp + 365 days);
        vm.prank(w1); // union raises it and approves in one step
        fledge.proposeResolution(id, Fledge.Kind.Settle, 1_200 * USD, 0, 0, 0, newEnd, "Pay 60% now, rest in 12 months");

        // Quorum is 2: one more witness, then the apprentice.
        vm.prank(w2);
        fledge.approveResolution(id);
        assertTrue(fledge.getResolution(id).open);
        vm.prank(boy);
        fledge.consentResolution(id);

        Fledge.Promise memory p = fledge.getPromise(id);
        assertEq(p.payable_, 1_200 * USD);
        assertEq(p.end, newEnd);
        assertEq(uint8(p.status), uint8(Fledge.Status.Active));
        assertEq(fledge.outstanding(id), 800 * USD);
        assertEq(fledge.held(id), 0);

        // Operator pays through Roqqu and records it, once.
        vm.prank(operator);
        fledge.markPaid(id, 1_200 * USD, "send-777");
        vm.prank(operator);
        vm.expectRevert(Fledge.ExceedsHeld.selector);
        fledge.markPaid(id, 1, "send-778");

        // The remainder is paid later and the promise closes.
        _credit(id, 800 * USD, "b");
        vm.warp(newEnd + 1);
        vm.prank(boy);
        fledge.proposeResolution(id, Fledge.Kind.Settle, 800 * USD, 0, 0, 0, 0, "balance");
        vm.prank(w1);
        fledge.approveResolution(id);
        vm.prank(w3);
        fledge.approveResolution(id);

        assertEq(uint8(fledge.getPromise(id).status), uint8(Fledge.Status.Closed));
        (uint32 closed,,, uint128 promised, uint128 delivered) = fledge.records(oga);
        assertEq(closed, 1);
        assertEq(promised, PROMISE);
        assertEq(delivered, PROMISE);
    }

    function test_remainderWithoutNewDateIsRejectedAfterEnd() public {
        uint256 id = _active();
        _credit(id, 1_200 * USD, "a");
        vm.warp(end + 1);
        vm.prank(w1);
        vm.expectRevert(Fledge.BadInput.selector);
        fledge.proposeResolution(id, Fledge.Kind.Settle, 1_200 * USD, 0, 0, 0, 0, "and the rest?");
    }

    function test_settlementInKindCountsTowardsThePromise() public {
        uint256 id = _active();
        _credit(id, 1_200 * USD, "a");
        vm.warp(end + 1);
        vm.prank(w1);
        fledge.proposeResolution(id, Fledge.Kind.InKind, 1_200 * USD, 800 * USD, 0, 0, 0, "Cash plus a year's shop rent");
        vm.prank(w2);
        fledge.approveResolution(id);
        vm.prank(boy);
        fledge.consentResolution(id);
        assertEq(uint8(fledge.getPromise(id).status), uint8(Fledge.Status.Closed));
        assertEq(fledge.getPromise(id).inKind, 800 * USD);
    }

    function test_cannotPayMoreThanIsHeld() public {
        uint256 id = _active();
        _credit(id, 1_200 * USD, "a");
        vm.warp(end + 1);
        vm.prank(boy);
        vm.expectRevert(Fledge.ExceedsHeld.selector);
        fledge.proposeResolution(id, Fledge.Kind.Settle, 2_000 * USD, 0, 0, 0, 0, "full please");
    }

    function test_earlyExitSplitsHeldFunds() public {
        uint256 id = _active();
        _credit(id, 500 * USD, "a");
        vm.warp(start + 365 days);
        vm.prank(boy);
        // Uneven split must account for everything held.
        vm.expectRevert(Fledge.BadInput.selector);
        fledge.proposeResolution(id, Fledge.Kind.EarlyExit, 100 * USD, 0, 100 * USD, 0, 0, "leaving");

        vm.prank(boy);
        fledge.proposeResolution(id, Fledge.Kind.EarlyExit, 300 * USD, 0, 200 * USD, 0, 0, "Leaving after year one");
        vm.prank(w1);
        fledge.approveResolution(id);
        vm.prank(w2);
        fledge.approveResolution(id);

        Fledge.Promise memory p = fledge.getPromise(id);
        assertEq(uint8(p.status), uint8(Fledge.Status.Closed));
        assertEq(p.payable_, 300 * USD);
        assertEq(p.refundable, 200 * USD);
        vm.prank(operator);
        fledge.markRefunded(id, 200 * USD, "send-oga");
    }

    function test_agreedReductionApplies() public {
        uint256 id = _active();
        vm.prank(oga);
        fledge.proposeResolution(id, Fledge.Kind.Reduce, 0, 0, 0, 400 * USD, 0, "Shop burnt in market fire");
        vm.prank(w1);
        fledge.approveResolution(id);
        vm.prank(w2);
        fledge.approveResolution(id);
        vm.prank(boy);
        fledge.consentResolution(id);
        assertEq(fledge.getPromise(id).promised, 1_600 * USD);
        (,, uint32 reductions,,) = fledge.records(oga);
        assertEq(reductions, 1);
    }

    function test_extensionMovesTheDate() public {
        uint256 id = _active();
        vm.warp(end + 1);
        uint64 newEnd = uint64(block.timestamp + 180 days);
        vm.prank(oga);
        fledge.proposeResolution(id, Fledge.Kind.Extend, 0, 0, 0, 0, newEnd, "Six more months");
        vm.prank(w1);
        fledge.approveResolution(id);
        vm.prank(w2);
        fledge.approveResolution(id);
        vm.prank(boy);
        fledge.consentResolution(id);
        assertEq(fledge.getPromise(id).end, newEnd);
        (, uint32 extensions,,,) = fledge.records(oga);
        assertEq(extensions, 1);
    }

    function test_strangerCannotAct() public {
        uint256 id = _active();
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(Fledge.NotWitness.selector);
        fledge.attestService(id, 1);
        vm.prank(stranger);
        vm.expectRevert(Fledge.NotParty.selector);
        fledge.proposeResolution(id, Fledge.Kind.Reduce, 0, 0, 0, 1, 0, "x");
    }

    // ---- disputes ----

    bytes32 constant EVIDENCE = keccak256("police report + shop ledger");
    bytes32 constant ANSWER = keccak256("apprentice statement");

    function _dispute(uint256 id, uint128 claim) internal {
        vm.prank(oga);
        fledge.raiseDispute(id, Fledge.Grounds.Theft, claim, EVIDENCE);
    }

    function test_ogaOrWitnessCanRaise_apprenticeCannot() public {
        uint256 id = _active();
        vm.prank(boy);
        vm.expectRevert(Fledge.NotParty.selector);
        fledge.raiseDispute(id, Fledge.Grounds.Theft, 100 * USD, EVIDENCE);
        vm.prank(oga);
        vm.expectRevert(Fledge.BadInput.selector);
        fledge.raiseDispute(id, Fledge.Grounds.Theft, 100 * USD, bytes32(0));
        vm.prank(w2);
        fledge.raiseDispute(id, Fledge.Grounds.Misconduct, 0, EVIDENCE);
        assertTrue(fledge.getDispute(id).open);
    }

    function test_disputeFreezesSettlementAndPayout() public {
        uint256 id = _active();
        _credit(id, 1_200 * USD, "a");
        vm.warp(end + 1);
        vm.prank(w1);
        fledge.proposeResolution(id, Fledge.Kind.Settle, 1_200 * USD, 0, 0, 0, uint64(block.timestamp + 365 days), "settle");
        _dispute(id, 500 * USD);
        // The apprentice cannot push the settlement through while the dispute is open.
        vm.prank(boy);
        vm.expectRevert(Fledge.Frozen.selector);
        fledge.consentResolution(id);
        vm.prank(w2);
        vm.expectRevert(Fledge.Frozen.selector);
        fledge.approveResolution(id);
        vm.prank(boy);
        vm.expectRevert(Fledge.Frozen.selector);
        fledge.proposeResolution(id, Fledge.Kind.Settle, 1_200 * USD, 0, 0, 0, uint64(block.timestamp + 365 days), "mine");
    }

    function test_witnessesWaitForTheAnswer() public {
        uint256 id = _active();
        _dispute(id, 100 * USD);
        vm.prank(w1);
        vm.expectRevert(Fledge.AnswerPending.selector);
        fledge.voteDispute(id, Fledge.Ruling.Restitution);
        vm.prank(boy);
        fledge.answerDispute(id, ANSWER);
        vm.prank(w1);
        fledge.voteDispute(id, Fledge.Ruling.Restitution);
    }

    function test_silenceDoesNotBlockTheWitnesses() public {
        uint256 id = _active();
        _dispute(id, 100 * USD);
        vm.warp(block.timestamp + 14 days);
        vm.prank(w1);
        fledge.voteDispute(id, Fledge.Ruling.Restitution);
    }

    function test_restitutionReturnsTheLossWithoutTheApprenticesConsent() public {
        uint256 id = _active();
        _credit(id, 1_200 * USD, "a");
        _dispute(id, 300 * USD);
        vm.prank(boy);
        fledge.answerDispute(id, ANSWER);
        vm.prank(w1);
        fledge.voteDispute(id, Fledge.Ruling.Restitution);
        vm.prank(w3);
        fledge.voteDispute(id, Fledge.Ruling.Restitution);
        Fledge.Promise memory p = fledge.getPromise(id);
        assertFalse(fledge.getDispute(id).open);
        assertEq(uint8(fledge.getDispute(id).ruling), uint8(Fledge.Ruling.Restitution));
        assertEq(p.refundable, 300 * USD);
        assertEq(p.promised, PROMISE - 300 * USD);
        assertEq(fledge.held(id), 900 * USD);
        assertEq(fledge.disputesUpheldAgainst(boy), 1);
        vm.prank(operator);
        fledge.markRefunded(id, 300 * USD, "send-oga-loss");
    }

    function test_restitutionNeverTakesMoreThanClaimedOrHeld() public {
        uint256 id = _active();
        _credit(id, 200 * USD, "a");
        _dispute(id, 500 * USD);
        vm.prank(boy);
        fledge.answerDispute(id, ANSWER);
        vm.prank(w1);
        fledge.voteDispute(id, Fledge.Ruling.Restitution);
        vm.prank(w2);
        fledge.voteDispute(id, Fledge.Ruling.Restitution);
        assertEq(fledge.getPromise(id).refundable, 200 * USD);
        assertEq(fledge.held(id), 0);
    }

    function test_forfeitNeedsEveryWitness() public {
        uint256 id = _active();
        _credit(id, 1_000 * USD, "a");
        _dispute(id, 400 * USD);
        vm.prank(boy);
        fledge.answerDispute(id, ANSWER);
        vm.prank(w1);
        fledge.voteDispute(id, Fledge.Ruling.Forfeit);
        vm.prank(w2);
        fledge.voteDispute(id, Fledge.Ruling.Forfeit);
        assertTrue(fledge.getDispute(id).open);
        vm.prank(w3);
        fledge.voteDispute(id, Fledge.Ruling.Forfeit);
        Fledge.Promise memory p = fledge.getPromise(id);
        assertEq(uint8(p.status), uint8(Fledge.Status.Closed));
        assertEq(p.refundable, 1_000 * USD);
    }

    function test_splitVoteFallsBackToRestitution() public {
        uint256 id = _active();
        _credit(id, 1_000 * USD, "a");
        _dispute(id, 400 * USD);
        vm.prank(boy);
        fledge.answerDispute(id, ANSWER);
        vm.prank(w1);
        fledge.voteDispute(id, Fledge.Ruling.Forfeit);
        vm.prank(w2);
        fledge.voteDispute(id, Fledge.Ruling.Dismiss);
        vm.prank(w3);
        fledge.voteDispute(id, Fledge.Ruling.Restitution);
        assertEq(uint8(fledge.getDispute(id).ruling), uint8(Fledge.Ruling.Restitution));
        assertEq(fledge.getPromise(id).refundable, 400 * USD);
    }

    function test_dismissedDisputeCountsAgainstTheOga() public {
        uint256 id = _active();
        _credit(id, 1_000 * USD, "a");
        _dispute(id, 400 * USD);
        vm.prank(boy);
        fledge.answerDispute(id, ANSWER);
        vm.prank(w1);
        fledge.voteDispute(id, Fledge.Ruling.Dismiss);
        vm.prank(w2);
        fledge.voteDispute(id, Fledge.Ruling.Dismiss);
        assertFalse(fledge.getDispute(id).open);
        assertEq(fledge.disputesDismissed(oga), 1);
        assertEq(fledge.getPromise(id).refundable, 0);
        assertEq(fledge.held(id), 1_000 * USD);
    }

    function test_undecidedDisputeLapses() public {
        uint256 id = _active();
        _dispute(id, 100 * USD);
        vm.expectRevert(Fledge.TooEarly.selector);
        fledge.lapseDispute(id);
        vm.warp(block.timestamp + 30 days + 1);
        fledge.lapseDispute(id);
        assertFalse(fledge.getDispute(id).open);
    }

    function test_strangerCannotVoteAndWitnessVotesOnce() public {
        uint256 id = _active();
        _dispute(id, 100 * USD);
        vm.prank(boy);
        fledge.answerDispute(id, ANSWER);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(Fledge.NotWitness.selector);
        fledge.voteDispute(id, Fledge.Ruling.Restitution);
        vm.prank(w1);
        fledge.voteDispute(id, Fledge.Ruling.Dismiss);
        vm.prank(w1);
        vm.expectRevert(Fledge.AlreadyApproved.selector);
        fledge.voteDispute(id, Fledge.Ruling.Restitution);
    }
}
