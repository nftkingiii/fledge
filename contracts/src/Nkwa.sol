// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Nkwa
/// @notice Records an Igba-boi settlement promise between an Oga and his apprentice,
/// tracks gradual funding received through Roqqu, and only lets value leave the
/// promise through a resolution approved by the apprentice and a witness quorum.
/// @dev Amounts are USD with 6 decimals, matching USDT. Funds are held in the
/// operator's Roqqu merchant balance; this contract is the rulebook and the record.
/// The operator can credit what Roqqu confirmed and mark payouts it executed, but it
/// can only pay out what an applied resolution made payable.
contract Nkwa {
    enum Status {
        None,
        Proposed,
        Active,
        Closed
    }

    enum Kind {
        Settle, // pay what is held now; any remainder rolls to newEnd
        InKind, // shop stock, rent or goods count towards the promise
        Extend, // more time, nothing paid now
        EarlyExit, // apprentice leaves before the end: pro-rata payout, rest back to the Oga
        Reduce // lower the promised amount
    }

    struct Promise {
        address oga;
        address apprentice;
        uint64 start;
        uint64 end;
        uint32 instalments;
        uint8 quorum;
        Status status;
        uint128 promised; // current promised total
        uint128 funded; // credited from Roqqu payments
        uint128 paidOut; // sent to the apprentice
        uint128 inKind; // value settled in goods
        uint128 refunded; // returned to the Oga (early exit only)
        uint128 payable_; // approved for the apprentice, not yet sent
        uint128 refundable; // approved for the Oga, not yet sent
        string trade;
    }

    struct Resolution {
        Kind kind;
        address proposer;
        uint128 payNow;
        uint128 inKindValue;
        uint128 refund;
        uint128 reduceBy;
        uint64 newEnd;
        uint8 approvals;
        bool apprenticeConsent;
        bool open;
        uint32 round;
        string note;
    }

    struct Record {
        uint32 promisesClosed;
        uint32 extensions;
        uint32 reductions;
        uint128 promisedClosed; // original promises on closed deals
        uint128 deliveredClosed; // cash + in kind delivered on closed deals
    }

    address public immutable operator;
    uint256 public count;

    mapping(uint256 => Promise) internal promises;
    mapping(uint256 => Resolution) internal resolutions;
    mapping(uint256 => address[]) internal witnessList;
    mapping(uint256 => mapping(address => bool)) public isWitness;
    mapping(uint256 => mapping(uint32 => mapping(address => bool))) public approvedRound;
    mapping(uint256 => uint128) public originalPromise;
    mapping(bytes32 => bool) public refUsed;
    mapping(address => Record) public records;

    event Proposed(uint256 indexed id, address indexed oga, address indexed apprentice, uint128 promised, uint64 end, string trade);
    event Accepted(uint256 indexed id);
    event Credited(uint256 indexed id, uint128 amount, string roqquRef, uint128 funded);
    event ServiceAttested(uint256 indexed id, address indexed witness, uint16 year);
    event ResolutionProposed(uint256 indexed id, uint32 round, Kind kind, address indexed proposer, string note);
    event ResolutionApproved(uint256 indexed id, uint32 round, address indexed by);
    event ResolutionApplied(uint256 indexed id, uint32 round, Kind kind, uint128 payNow, uint128 refund);
    event PaidOut(uint256 indexed id, uint128 amount, string roqquRef);
    event Refunded(uint256 indexed id, uint128 amount, string roqquRef);
    event Closed(uint256 indexed id, uint128 promised, uint128 delivered);

    error NotOperator();
    error NotParty();
    error NotWitness();
    error BadState();
    error BadInput();
    error RefReused();
    error TooEarly();
    error ExceedsHeld();
    error ExceedsOutstanding();
    error AlreadyApproved();
    error NoOpenResolution();

    constructor(address operator_) {
        operator = operator_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    // ---- setup ----

    function propose(
        address apprentice,
        address[] calldata witnesses_,
        uint8 quorum,
        uint128 promised,
        uint64 start,
        uint64 end,
        uint32 instalments,
        string calldata trade
    ) external returns (uint256 id) {
        if (apprentice == address(0) || apprentice == msg.sender) revert BadInput();
        if (promised == 0 || end <= start || instalments == 0) revert BadInput();
        if (quorum == 0 || quorum > witnesses_.length) revert BadInput();

        id = ++count;
        for (uint256 i; i < witnesses_.length; i++) {
            address w = witnesses_[i];
            if (w == address(0) || w == msg.sender || w == apprentice || isWitness[id][w]) revert BadInput();
            isWitness[id][w] = true;
            witnessList[id].push(w);
        }
        Promise storage p = promises[id];
        p.oga = msg.sender;
        p.apprentice = apprentice;
        p.start = start;
        p.end = end;
        p.instalments = instalments;
        p.quorum = quorum;
        p.status = Status.Proposed;
        p.promised = promised;
        p.trade = trade;
        originalPromise[id] = promised;
        emit Proposed(id, msg.sender, apprentice, promised, end, trade);
    }

    function accept(uint256 id) external {
        Promise storage p = promises[id];
        if (msg.sender != p.apprentice) revert NotParty();
        if (p.status != Status.Proposed) revert BadState();
        p.status = Status.Active;
        emit Accepted(id);
    }

    // ---- funding (Roqqu payment links, confirmed by webhook) ----

    function credit(uint256 id, uint128 amount, string calldata roqquRef) external onlyOperator {
        Promise storage p = promises[id];
        if (p.status != Status.Active) revert BadState();
        if (amount == 0) revert BadInput();
        bytes32 key = keccak256(bytes(roqquRef));
        if (refUsed[key]) revert RefReused();
        refUsed[key] = true;
        p.funded += amount;
        emit Credited(id, amount, roqquRef, p.funded);
    }

    // ---- service record ----

    function attestService(uint256 id, uint16 year) external {
        if (!isWitness[id][msg.sender]) revert NotWitness();
        if (promises[id].status != Status.Active) revert BadState();
        emit ServiceAttested(id, msg.sender, year);
    }

    // ---- resolutions ----

    function proposeResolution(
        uint256 id,
        Kind kind,
        uint128 payNow,
        uint128 inKindValue,
        uint128 refund,
        uint128 reduceBy,
        uint64 newEnd,
        string calldata note
    ) external {
        Promise storage p = promises[id];
        if (p.status != Status.Active) revert BadState();
        bool apprentice = msg.sender == p.apprentice;
        if (msg.sender != p.oga && !apprentice && !isWitness[id][msg.sender]) revert NotParty();

        // Before the end date only an early exit or a reduction can be raised.
        if (block.timestamp < p.end && kind != Kind.EarlyExit && kind != Kind.Reduce) revert TooEarly();
        if (kind == Kind.EarlyExit && msg.sender == p.oga) revert NotParty();
        if (refund > 0 && kind != Kind.EarlyExit) revert BadInput();
        if (payNow + refund > held(id)) revert ExceedsHeld();
        // An early exit closes the promise, so every held naira must go somewhere.
        if (kind == Kind.EarlyExit && payNow + refund != held(id)) revert BadInput();
        uint128 out = outstanding(id);
        if (payNow + inKindValue + reduceBy > out) revert ExceedsOutstanding();
        if (kind == Kind.Extend && newEnd == 0) revert BadInput();

        // Anything left unpaid needs a date to be paid by.
        bool closes = kind == Kind.EarlyExit || payNow + inKindValue + reduceBy == out;
        if (!closes) {
            if (newEnd != 0) {
                if (newEnd <= block.timestamp || newEnd <= p.end) revert BadInput();
            } else if (block.timestamp >= p.end) {
                revert BadInput();
            }
        }

        Resolution storage r = resolutions[id];
        r.round += 1;
        r.kind = kind;
        r.proposer = msg.sender;
        r.payNow = payNow;
        r.inKindValue = inKindValue;
        r.refund = refund;
        r.reduceBy = reduceBy;
        r.newEnd = newEnd;
        r.approvals = 0;
        r.apprenticeConsent = apprentice;
        r.open = true;
        r.note = note;
        emit ResolutionProposed(id, r.round, kind, msg.sender, note);

        if (isWitness[id][msg.sender]) _approve(id, r);
        _tryApply(id);
    }

    function approveResolution(uint256 id) external {
        Resolution storage r = resolutions[id];
        if (!r.open) revert NoOpenResolution();
        if (!isWitness[id][msg.sender]) revert NotWitness();
        _approve(id, r);
        _tryApply(id);
    }

    function consentResolution(uint256 id) external {
        Resolution storage r = resolutions[id];
        if (!r.open) revert NoOpenResolution();
        if (msg.sender != promises[id].apprentice) revert NotParty();
        r.apprenticeConsent = true;
        _tryApply(id);
    }

    function _approve(uint256 id, Resolution storage r) internal {
        if (approvedRound[id][r.round][msg.sender]) revert AlreadyApproved();
        approvedRound[id][r.round][msg.sender] = true;
        r.approvals += 1;
        emit ResolutionApproved(id, r.round, msg.sender);
    }

    function _tryApply(uint256 id) internal {
        Promise storage p = promises[id];
        Resolution storage r = resolutions[id];
        if (!r.open || !r.apprenticeConsent || r.approvals < p.quorum) return;

        // Re-check against current balances: credits may have landed since proposal.
        if (r.payNow + r.refund > held(id)) revert ExceedsHeld();
        if (r.payNow + r.inKindValue + r.reduceBy > outstanding(id)) revert ExceedsOutstanding();

        r.open = false;
        p.payable_ += r.payNow;
        p.refundable += r.refund;
        p.inKind += r.inKindValue;
        p.promised -= r.reduceBy;

        Record storage rec = records[p.oga];
        if (r.kind == Kind.Reduce) rec.reductions += 1;
        if (r.kind == Kind.Extend) rec.extensions += 1;

        emit ResolutionApplied(id, r.round, r.kind, r.payNow, r.refund);

        // outstanding() already counts payable_ as delivered.
        uint128 left = outstanding(id);
        if (r.kind == Kind.EarlyExit || left == 0) {
            _close(id);
        } else if (r.newEnd != 0) {
            p.end = r.newEnd;
        }
    }

    function _close(uint256 id) internal {
        Promise storage p = promises[id];
        p.status = Status.Closed;
        uint128 delivered = p.paidOut + p.payable_ + p.inKind;
        Record storage rec = records[p.oga];
        rec.promisesClosed += 1;
        rec.promisedClosed += originalPromise[id];
        rec.deliveredClosed += delivered;
        emit Closed(id, originalPromise[id], delivered);
    }

    // ---- payouts executed through Roqqu ----

    function markPaid(uint256 id, uint128 amount, string calldata roqquRef) external onlyOperator {
        Promise storage p = promises[id];
        if (amount == 0 || amount > p.payable_) revert ExceedsHeld();
        bytes32 key = keccak256(bytes(roqquRef));
        if (refUsed[key]) revert RefReused();
        refUsed[key] = true;
        p.payable_ -= amount;
        p.paidOut += amount;
        emit PaidOut(id, amount, roqquRef);
    }

    function markRefunded(uint256 id, uint128 amount, string calldata roqquRef) external onlyOperator {
        Promise storage p = promises[id];
        if (amount == 0 || amount > p.refundable) revert ExceedsHeld();
        bytes32 key = keccak256(bytes(roqquRef));
        if (refUsed[key]) revert RefReused();
        refUsed[key] = true;
        p.refundable -= amount;
        p.refunded += amount;
        emit Refunded(id, amount, roqquRef);
    }

    // ---- views ----

    /// @notice Money credited and not yet paid, refunded or earmarked.
    function held(uint256 id) public view returns (uint128) {
        Promise storage p = promises[id];
        return p.funded - p.paidOut - p.refunded - p.payable_ - p.refundable;
    }

    /// @notice Promise value not yet delivered in cash (paid or payable) or in kind.
    function outstanding(uint256 id) public view returns (uint128) {
        Promise storage p = promises[id];
        uint128 delivered = p.paidOut + p.payable_ + p.inKind;
        return p.promised > delivered ? p.promised - delivered : 0;
    }

    /// @notice What the funding schedule says should have been credited by now.
    function dueByNow(uint256 id) public view returns (uint128) {
        Promise storage p = promises[id];
        if (p.status == Status.None || block.timestamp <= p.start) return 0;
        uint256 period = (uint256(p.end) - p.start) / p.instalments;
        uint256 elapsed = period == 0 ? p.instalments : (block.timestamp - p.start) / period;
        if (elapsed > p.instalments) elapsed = p.instalments;
        uint256 due = uint256(originalPromise[id]) * elapsed / p.instalments;
        // A reduction lowers the target too.
        if (due > p.promised) due = p.promised;
        return uint128(due);
    }

    function arrears(uint256 id) external view returns (uint128) {
        uint128 due = dueByNow(id);
        uint128 f = promises[id].funded;
        return due > f ? due - f : 0;
    }

    function getPromise(uint256 id) external view returns (Promise memory) {
        return promises[id];
    }

    function getResolution(uint256 id) external view returns (Resolution memory) {
        return resolutions[id];
    }

    function witnesses(uint256 id) external view returns (address[] memory) {
        return witnessList[id];
    }
}
