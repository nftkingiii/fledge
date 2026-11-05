import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

export const abi = parseAbi([
  "struct Promise { address oga; address apprentice; uint64 start; uint64 end; uint32 instalments; uint8 quorum; uint8 status; uint128 promised; uint128 funded; uint128 paidOut; uint128 inKind; uint128 refunded; uint128 payable_; uint128 refundable; string trade; }",
  "struct Resolution { uint8 kind; address proposer; uint128 payNow; uint128 inKindValue; uint128 refund; uint128 reduceBy; uint64 newEnd; uint8 approvals; bool apprenticeConsent; bool open; uint32 round; string note; }",
  "function count() view returns (uint256)",
  "function operator() view returns (address)",
  "function getPromise(uint256 id) view returns (Promise)",
  "function getResolution(uint256 id) view returns (Resolution)",
  "function witnesses(uint256 id) view returns (address[])",
  "function held(uint256 id) view returns (uint128)",
  "function outstanding(uint256 id) view returns (uint128)",
  "function dueByNow(uint256 id) view returns (uint128)",
  "function arrears(uint256 id) view returns (uint128)",
  "function originalPromise(uint256 id) view returns (uint128)",
  "function records(address oga) view returns (uint32 promisesClosed, uint32 extensions, uint32 reductions, uint128 promisedClosed, uint128 deliveredClosed)",
  "function approvedRound(uint256 id, uint32 round, address who) view returns (bool)",
  "function propose(address apprentice, address[] witnesses_, uint8 quorum, uint128 promised, uint64 start, uint64 end, uint32 instalments, string trade) returns (uint256)",
  "function accept(uint256 id)",
  "function credit(uint256 id, uint128 amount, string roqquRef)",
  "function attestService(uint256 id, uint16 year)",
  "function proposeResolution(uint256 id, uint8 kind, uint128 payNow, uint128 inKindValue, uint128 refund, uint128 reduceBy, uint64 newEnd, string note)",
  "function approveResolution(uint256 id)",
  "function consentResolution(uint256 id)",
  "function markPaid(uint256 id, uint128 amount, string roqquRef)",
  "function markRefunded(uint256 id, uint128 amount, string roqquRef)",
  "event Proposed(uint256 indexed id, address indexed oga, address indexed apprentice, uint128 promised, uint64 end, string trade)",
  "event Accepted(uint256 indexed id)",
  "event Credited(uint256 indexed id, uint128 amount, string roqquRef, uint128 funded)",
  "event ServiceAttested(uint256 indexed id, address indexed witness, uint16 year)",
  "event ResolutionProposed(uint256 indexed id, uint32 round, uint8 kind, address indexed proposer, string note)",
  "event ResolutionApproved(uint256 indexed id, uint32 round, address indexed by)",
  "event ResolutionApplied(uint256 indexed id, uint32 round, uint8 kind, uint128 payNow, uint128 refund)",
  "event PaidOut(uint256 indexed id, uint128 amount, string roqquRef)",
  "event Refunded(uint256 indexed id, uint128 amount, string roqquRef)",
  "event Closed(uint256 indexed id, uint128 promised, uint128 delivered)",
  "error NotOperator()",
  "error NotParty()",
  "error NotWitness()",
  "error BadState()",
  "error BadInput()",
  "error RefReused()",
  "error TooEarly()",
  "error ExceedsHeld()",
  "error ExceedsOutstanding()",
  "error AlreadyApproved()",
  "error NoOpenResolution()",
]);

export const KINDS = ["Settle", "InKind", "Extend", "EarlyExit", "Reduce"];
export const STATUS = ["None", "Proposed", "Active", "Closed"];

const address = process.env.NKWA_ADDRESS;
const transport = http(process.env.RPC_URL || baseSepolia.rpcUrls.default.http[0]);
// Reads issued together go out as one Multicall3 call, which keeps the public RPC's rate limit at bay.
export const publicClient = createPublicClient({ chain: baseSepolia, transport, batch: { multicall: true } });

export const operator = process.env.OPERATOR_KEY ? privateKeyToAccount(process.env.OPERATOR_KEY) : null;

// Demo mode signs as these roles from the server. It is labelled as such in the UI.
const ROLE_NAMES = ["oga", "apprentice", "union", "uncle", "pastor"];
export const demoRoles = Object.fromEntries(
  (process.env.DEMO_KEYS || "")
    .split(",")
    .filter(Boolean)
    .map((k, i) => [ROLE_NAMES[i], privateKeyToAccount(k.trim())])
);

export function configured() {
  return Boolean(address && operator);
}

export function contractAddress() {
  return address;
}

async function write(account, functionName, args) {
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const { request } = await publicClient.simulateContract({ account, address, abi, functionName, args });
  const hash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted in ${hash}`);
  return { hash, receipt };
}

export const asOperator = (fn, args) => write(operator, fn, args);
export function asRole(role, fn, args) {
  const account = demoRoles[role];
  if (!account) throw new Error(`No demo signer for ${role}`);
  return write(account, fn, args);
}

const read = (functionName, args = []) => publicClient.readContract({ address, abi, functionName, args });

export async function count() {
  return Number(await read("count"));
}

export async function readPromise(id) {
  const big = BigInt(id);
  const [p, r, ws, held, outstanding, due, arrears, original] = await Promise.all([
    read("getPromise", [big]),
    read("getResolution", [big]),
    read("witnesses", [big]),
    read("held", [big]),
    read("outstanding", [big]),
    read("dueByNow", [big]),
    read("arrears", [big]),
    read("originalPromise", [big]),
  ]);
  if (p.status === 0) return null;
  const approvals = await Promise.all(ws.map((w) => read("approvedRound", [big, r.round, w])));
  const rec = await read("records", [p.oga]);
  return {
    id: Number(id),
    oga: p.oga,
    apprentice: p.apprentice,
    trade: p.trade,
    status: STATUS[p.status],
    start: Number(p.start),
    end: Number(p.end),
    instalments: p.instalments,
    quorum: p.quorum,
    original: usd(original),
    promised: usd(p.promised),
    funded: usd(p.funded),
    paidOut: usd(p.paidOut),
    inKind: usd(p.inKind),
    refunded: usd(p.refunded),
    payable: usd(p.payable_),
    refundable: usd(p.refundable),
    held: usd(held),
    outstanding: usd(outstanding),
    dueByNow: usd(due),
    arrears: usd(arrears),
    witnesses: ws.map((w, i) => ({ address: w, approved: approvals[i] })),
    resolution: r.round === 0 ? null : {
      round: r.round,
      kind: KINDS[r.kind],
      proposer: r.proposer,
      payNow: usd(r.payNow),
      inKindValue: usd(r.inKindValue),
      refund: usd(r.refund),
      reduceBy: usd(r.reduceBy),
      newEnd: Number(r.newEnd),
      approvals: r.approvals,
      apprenticeConsent: r.apprenticeConsent,
      open: r.open,
      note: r.note,
    },
    record: {
      promisesClosed: rec[0],
      extensions: rec[1],
      reductions: rec[2],
      promisedClosed: usd(rec[3]),
      deliveredClosed: usd(rec[4]),
    },
  };
}

// Logs are re-derived from the chain after a restart; the cache only saves RPC calls.
const logCache = { next: null, events: new Map() };
// Load-balanced RPC nodes can lag the head by a few blocks, so recent blocks are re-read.
const REORG_MARGIN = 20n;

/** Event history for one promise, read in chunks the public RPC accepts. */
export async function timeline(id) {
  const deployBlock = BigInt(process.env.DEPLOY_BLOCK || 0);
  if (logCache.next === null) logCache.next = deployBlock;
  const latest = await publicClient.getBlockNumber();
  // sepolia.base.org caps eth_getLogs at 200 blocks per call.
  const step = BigInt(process.env.LOG_STEP || 200);
  const from = logCache.next - REORG_MARGIN > deployBlock ? logCache.next - REORG_MARGIN : deployBlock;
  for (let start = from; start <= latest; start += step) {
    const end = start + step - 1n > latest ? latest : start + step - 1n;
    const chunk = await publicClient.getLogs({ address, fromBlock: start, toBlock: end });
    for (const l of parseEventLogs({ abi, logs: chunk })) logCache.events.set(`${l.transactionHash}:${l.logIndex}`, l);
    logCache.next = end + 1n;
  }
  return [...logCache.events.values()]
    .sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex)
    .filter((l) => l.args.id === BigInt(id))
    .map((l) => ({
      event: l.eventName,
      tx: l.transactionHash,
      block: Number(l.blockNumber),
      args: Object.fromEntries(
        Object.entries(l.args).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])
      ),
    }));
}

export function usd(v) {
  return Number(v) / 1e6;
}

export function toMicro(amountUsd) {
  return BigInt(Math.round(Number(amountUsd) * 1e6));
}
