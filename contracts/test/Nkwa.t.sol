// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Nkwa} from "../src/Nkwa.sol";

contract NkwaTest is Test {
    Nkwa nkwa;
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
        nkwa = new Nkwa(operator);
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
        id = nkwa.propose(boy, _witnesses(), 2, PROMISE, start, end, 16, "Auto spare parts, Nnewi");
        vm.prank(boy);
        nkwa.accept(id);
    }

    function _credit(uint256 id, uint128 amount, string memory ref) internal {
        vm.prank(operator);
        nkwa.credit(id, amount, ref);
    }

    function test_onlyApprenticeCanAccept() public {
        vm.prank(oga);
        uint256 id = nkwa.propose(boy, _witnesses(), 2, PROMISE, start, end, 16, "Textiles");
        vm.prank(oga);
        vm.expectRevert(Nkwa.NotParty.selector);
        nkwa.accept(id);
        vm.prank(boy);
        nkwa.accept(id);
        assertEq(uint8(nkwa.getPromise(id).status), uint8(Nkwa.Status.Active));
    }

    function test_quorumMustFitWitnesses() public {
        vm.prank(oga);
        vm.expectRevert(Nkwa.BadInput.selector);
        nkwa.propose(boy, _witnesses(), 4, PROMISE, start, end, 16, "x");
    }

    function test_onlyOperatorCredits_andRefsAreSingleUse() public {
        uint256 id = _active();
        vm.prank(oga);
        vm.expectRevert(Nkwa.NotOperator.selector);
        nkwa.credit(id, 100 * USD, "ref1");

        _credit(id, 125 * USD, "NKWA1I1");
        vm.prank(operator);
        vm.expectRevert(Nkwa.RefReused.selector);
        nkwa.credit(id, 125 * USD, "NKWA1I1");
        assertEq(nkwa.getPromise(id).funded, 125 * USD);
    }

    function test_missedQuarterShowsArrears() public {
        uint256 id = _active();
        // 16 instalments over 4 years: one per quarter, 125 USD each.
        vm.warp(start + 3 * 91.25 days + 1);
        _credit(id, 125 * USD, "q1");
        _credit(id, 125 * USD, "q2");
        assertEq(nkwa.dueByNow(id), 375 * USD);
        assertEq(nkwa.arrears(id), 125 * USD);
    }

    function test_settlementCannotBeRaisedBeforeEnd() public {
        uint256 id = _active();
        _credit(id, 500 * USD, "a");
        vm.prank(boy);
        vm.expectRevert(Nkwa.TooEarly.selector);
        nkwa.proposeResolution(id, Nkwa.Kind.Settle, 500 * USD, 0, 0, 0, 0, "early");
    }

    function test_ogaCannotCutThePromiseAlone() public {
        uint256 id = _active();
        vm.prank(oga);
        nkwa.proposeResolution(id, Nkwa.Kind.Reduce, 0, 0, 0, 800 * USD, 0, "business is slow");
        // Even with every witness behind him, the apprentice has not consented.
        vm.prank(w1);
        nkwa.approveResolution(id);
        vm.prank(w2);
        nkwa.approveResolution(id);
        vm.prank(w3);
        nkwa.approveResolution(id);
        assertEq(nkwa.getPromise(id).promised, PROMISE);
        assertTrue(nkwa.getResolution(id).open);
    }

    function test_ogaHasNoWayToPullFundsBack() public {
        uint256 id = _active();
        _credit(id, 1_000 * USD, "a");
        // An Oga cannot raise an early exit to take back what he paid in.
        vm.prank(oga);
        vm.expectRevert(Nkwa.NotParty.selector);
        nkwa.proposeResolution(id, Nkwa.Kind.EarlyExit, 0, 0, 1_000 * USD, 0, 0, "refund me");
        // And the operator cannot pay out what no resolution approved.
        vm.prank(operator);
        vm.expectRevert(Nkwa.ExceedsHeld.selector);
        nkwa.markPaid(id, 1 * USD, "send1");
    }

    function test_witnessesCanOnlyApproveOncePerRound() public {
        uint256 id = _active();
        vm.prank(oga);
        nkwa.proposeResolution(id, Nkwa.Kind.Reduce, 0, 0, 0, 100 * USD, 0, "x");
        vm.prank(w1);
        nkwa.approveResolution(id);
        vm.prank(w1);
        vm.expectRevert(Nkwa.AlreadyApproved.selector);
        nkwa.approveResolution(id);
    }

    function test_partialSettlementWithRepaymentPlan() public {
        uint256 id = _active();
        _credit(id, 1_200 * USD, "a"); // 60% funded
        vm.warp(end + 1);

        uint64 newEnd = uint64(block.timestamp + 365 days);
        vm.prank(w1); // union raises it and approves in one step
        nkwa.proposeResolution(id, Nkwa.Kind.Settle, 1_200 * USD, 0, 0, 0, newEnd, "Pay 60% now, rest in 12 months");

        // Quorum is 2: one more witness, then the apprentice.
        vm.prank(w2);
        nkwa.approveResolution(id);
        assertTrue(nkwa.getResolution(id).open);
        vm.prank(boy);
        nkwa.consentResolution(id);

        Nkwa.Promise memory p = nkwa.getPromise(id);
        assertEq(p.payable_, 1_200 * USD);
        assertEq(p.end, newEnd);
        assertEq(uint8(p.status), uint8(Nkwa.Status.Active));
        assertEq(nkwa.outstanding(id), 800 * USD);
        assertEq(nkwa.held(id), 0);

        // Operator pays through Roqqu and records it, once.
        vm.prank(operator);
        nkwa.markPaid(id, 1_200 * USD, "send-777");
        vm.prank(operator);
        vm.expectRevert(Nkwa.ExceedsHeld.selector);
        nkwa.markPaid(id, 1, "send-778");

        // The remainder is paid later and the promise closes.
        _credit(id, 800 * USD, "b");
        vm.warp(newEnd + 1);
        vm.prank(boy);
        nkwa.proposeResolution(id, Nkwa.Kind.Settle, 800 * USD, 0, 0, 0, 0, "balance");
        vm.prank(w1);
        nkwa.approveResolution(id);
        vm.prank(w3);
        nkwa.approveResolution(id);

        assertEq(uint8(nkwa.getPromise(id).status), uint8(Nkwa.Status.Closed));
        (uint32 closed,,, uint128 promised, uint128 delivered) = nkwa.records(oga);
        assertEq(closed, 1);
        assertEq(promised, PROMISE);
        assertEq(delivered, PROMISE);
    }

    function test_remainderWithoutNewDateIsRejectedAfterEnd() public {
        uint256 id = _active();
        _credit(id, 1_200 * USD, "a");
        vm.warp(end + 1);
        vm.prank(w1);
        vm.expectRevert(Nkwa.BadInput.selector);
        nkwa.proposeResolution(id, Nkwa.Kind.Settle, 1_200 * USD, 0, 0, 0, 0, "and the rest?");
    }

    function test_settlementInKindCountsTowardsThePromise() public {
        uint256 id = _active();
        _credit(id, 1_200 * USD, "a");
        vm.warp(end + 1);
        vm.prank(w1);
        nkwa.proposeResolution(id, Nkwa.Kind.InKind, 1_200 * USD, 800 * USD, 0, 0, 0, "Cash plus a year's shop rent");
        vm.prank(w2);
        nkwa.approveResolution(id);
        vm.prank(boy);
        nkwa.consentResolution(id);
        assertEq(uint8(nkwa.getPromise(id).status), uint8(Nkwa.Status.Closed));
        assertEq(nkwa.getPromise(id).inKind, 800 * USD);
    }

    function test_cannotPayMoreThanIsHeld() public {
        uint256 id = _active();
        _credit(id, 1_200 * USD, "a");
        vm.warp(end + 1);
        vm.prank(boy);
        vm.expectRevert(Nkwa.ExceedsHeld.selector);
        nkwa.proposeResolution(id, Nkwa.Kind.Settle, 2_000 * USD, 0, 0, 0, 0, "full please");
    }

    function test_earlyExitSplitsHeldFunds() public {
        uint256 id = _active();
        _credit(id, 500 * USD, "a");
        vm.warp(start + 365 days);
        vm.prank(boy);
        // Uneven split must account for everything held.
        vm.expectRevert(Nkwa.BadInput.selector);
        nkwa.proposeResolution(id, Nkwa.Kind.EarlyExit, 100 * USD, 0, 100 * USD, 0, 0, "leaving");

        vm.prank(boy);
        nkwa.proposeResolution(id, Nkwa.Kind.EarlyExit, 300 * USD, 0, 200 * USD, 0, 0, "Leaving after year one");
        vm.prank(w1);
        nkwa.approveResolution(id);
        vm.prank(w2);
        nkwa.approveResolution(id);

        Nkwa.Promise memory p = nkwa.getPromise(id);
        assertEq(uint8(p.status), uint8(Nkwa.Status.Closed));
        assertEq(p.payable_, 300 * USD);
        assertEq(p.refundable, 200 * USD);
        vm.prank(operator);
        nkwa.markRefunded(id, 200 * USD, "send-oga");
    }

    function test_agreedReductionApplies() public {
        uint256 id = _active();
        vm.prank(oga);
        nkwa.proposeResolution(id, Nkwa.Kind.Reduce, 0, 0, 0, 400 * USD, 0, "Shop burnt in market fire");
        vm.prank(w1);
        nkwa.approveResolution(id);
        vm.prank(w2);
        nkwa.approveResolution(id);
        vm.prank(boy);
        nkwa.consentResolution(id);
        assertEq(nkwa.getPromise(id).promised, 1_600 * USD);
        (,, uint32 reductions,,) = nkwa.records(oga);
        assertEq(reductions, 1);
    }

    function test_extensionMovesTheDate() public {
        uint256 id = _active();
        vm.warp(end + 1);
        uint64 newEnd = uint64(block.timestamp + 180 days);
        vm.prank(oga);
        nkwa.proposeResolution(id, Nkwa.Kind.Extend, 0, 0, 0, 0, newEnd, "Six more months");
        vm.prank(w1);
        nkwa.approveResolution(id);
        vm.prank(w2);
        nkwa.approveResolution(id);
        vm.prank(boy);
        nkwa.consentResolution(id);
        assertEq(nkwa.getPromise(id).end, newEnd);
        (, uint32 extensions,,,) = nkwa.records(oga);
        assertEq(extensions, 1);
    }

    function test_strangerCannotAct() public {
        uint256 id = _active();
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(Nkwa.NotWitness.selector);
        nkwa.attestService(id, 1);
        vm.prank(stranger);
        vm.expectRevert(Nkwa.NotParty.selector);
        nkwa.proposeResolution(id, Nkwa.Kind.Reduce, 0, 0, 0, 1, 0, "x");
    }
}
