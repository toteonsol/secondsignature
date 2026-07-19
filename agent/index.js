// Second Signature guardian agent service.
// Watches every GuardianVault spawned by the factory, and when an owner proposes
// a transaction, gathers on-chain context, asks Claude for a verdict, and
// co-signs (approve) or argues back (object), with its reasoning stored on-chain.

import http from "node:http";
import { createPublicClient, createWalletClient, http as viemHttp, formatEther, parseAbi, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import Anthropic from "@anthropic-ai/sdk";

const {
  GUARDIAN_PRIVATE_KEY,
  RPC_URL = "https://rpc.monad.xyz",
  CHAIN_ID = "143",
  FACTORY_ADDRESS,
  ANTHROPIC_API_KEY,
  OPENROUTER_API_KEY,
  POLL_MS = "3000",
  PORT = "8787",
} = process.env;

if (!GUARDIAN_PRIVATE_KEY || !FACTORY_ADDRESS) {
  console.error("Missing GUARDIAN_PRIVATE_KEY or FACTORY_ADDRESS");
  process.exit(1);
}

const chain = {
  id: Number(CHAIN_ID),
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const account = privateKeyToAccount(GUARDIAN_PRIVATE_KEY);
const pub = createPublicClient({ chain, transport: viemHttp(RPC_URL) });
const wallet = createWalletClient({ account, chain, transport: viemHttp(RPC_URL) });
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const vaultAbi = parseAbi([
  "function approve(uint256 id, string reason)",
  "function object(uint256 id, string reason)",
  "function proposals(uint256) view returns (address to, uint256 value, bytes data, uint64 proposedAt, uint8 status)",
  "function owner() view returns (address)",
  "function proposalCount() view returns (uint256)",
]);
const vaultCreatedEvent = parseAbiItem(
  "event VaultCreated(address indexed owner, address indexed vault, address indexed guardian)"
);
const proposedEvent = parseAbiItem(
  "event Proposed(uint256 indexed id, address indexed to, uint256 value, bytes data)"
);

const vaults = new Set(); // vault addresses guarded by us
const decisions = []; // in-memory log served to the frontend
const handled = new Set(); // `${vault}:${id}` already processed
let fromBlock = 0n;

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

async function gatherContext(vault, id, p) {
  const [to, value, data] = [p[0], p[1], p[2]];
  const [vaultBalance, destBalance, destTxCount, destCode] = await Promise.all([
    pub.getBalance({ address: vault }),
    pub.getBalance({ address: to }),
    pub.getTransactionCount({ address: to }),
    pub.getCode({ address: to }).catch(() => undefined),
  ]);
  const priorDecisions = decisions.filter((d) => d.vault === vault).slice(-5);
  return {
    vault,
    proposalId: id.toString(),
    destination: to,
    amountMON: formatEther(value),
    vaultBalanceMON: formatEther(vaultBalance),
    pctOfBalance: vaultBalance > 0n ? Number((value * 10000n) / vaultBalance) / 100 : 0,
    callData: data && data !== "0x" ? data : null,
    destinationIsContract: !!(destCode && destCode !== "0x"),
    destinationBalanceMON: formatEther(destBalance),
    destinationTxCount: destTxCount,
    utcHour: new Date().getUTCHours(),
    priorDecisions: priorDecisions.map((d) => ({ approved: d.approved, reason: d.reason })),
  };
}

// Deterministic fallback so the vault still works if the LLM is unreachable.
function heuristicVerdict(ctx) {
  const flags = [];
  if (ctx.pctOfBalance >= 80) flags.push(`this transfer is ${ctx.pctOfBalance}% of the vault's entire balance`);
  if (ctx.destinationTxCount === 0 && ctx.destinationBalanceMON === "0" && !ctx.destinationIsContract)
    flags.push("the destination is a brand-new address with no history at all");
  if (ctx.callData && !ctx.destinationIsContract) flags.push("calldata is attached but the destination is not a contract");
  if (flags.length)
    return { approve: false, reason: `I'm holding my signature: ${flags.join("; ")}. If this is really you and really intentional, cancel it and try a small test amount first. You can also override me after the 48 hour delay.` };
  return { approve: true, reason: "Routine transaction: modest fraction of balance, destination has history. Co-signed." };
}

const GUARDIAN_SYSTEM = `You are the guardian co-signer of a user's crypto vault on Monad. Your ONLY job is to protect the owner from irreversible mistakes: wallet drains, fat-fingered amounts, phishing destinations, panic moves. You cannot steal (your signature alone moves nothing) and you cannot lock the owner out (they can override you after 48h), so be brave about objecting, but don't nag about routine activity. Style rules for the reason: speak directly to the owner in first person, plain warm language a newcomer understands, be concrete about what you saw, 1-3 sentences, and never use em dashes. Respond ONLY with JSON: {"approve": boolean, "reason": "..."}.`;

async function llmText(ctx) {
  const user = `Proposed transaction context:\n${JSON.stringify(ctx, null, 2)}`;
  if (anthropic) {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 400,
      system: GUARDIAN_SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    return msg.content.find((b) => b.type === "text")?.text ?? "";
  }
  // OpenRouter path (OpenAI-style API)
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4.5",
      max_tokens: 400,
      messages: [
        { role: "system", content: GUARDIAN_SYSTEM },
        { role: "user", content: user },
      ],
    }),
  }).then((x) => x.json());
  if (r.error) throw new Error(r.error.message ?? "openrouter error");
  return r.choices?.[0]?.message?.content ?? "";
}

async function verdictFor(ctx) {
  if (!anthropic && !OPENROUTER_API_KEY) return heuristicVerdict(ctx);
  try {
    const text = await llmText(ctx);
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (typeof parsed.approve === "boolean" && typeof parsed.reason === "string") return parsed;
    throw new Error("bad shape");
  } catch (e) {
    log("LLM verdict failed, falling back to heuristics:", e.message);
    return heuristicVerdict(ctx);
  }
}

async function handleProposal(vault, id) {
  const key = `${vault}:${id}`;
  if (handled.has(key)) return;
  handled.add(key);
  try {
    const p = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "proposals", args: [id] });
    if (p[4] !== 0) return; // not Pending
    const ctx = await gatherContext(vault, id, p);
    log(`Proposal ${key}: ${ctx.amountMON} MON (${ctx.pctOfBalance}% of vault) -> ${ctx.destination}`);
    const v = await verdictFor(ctx);
    const fn = v.approve ? "approve" : "object";
    const hash = await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: fn, args: [id, v.reason] });
    await pub.waitForTransactionReceipt({ hash });
    decisions.push({ vault, id: id.toString(), approved: v.approve, reason: v.reason, tx: hash, at: Date.now(), ctx });
    log(`${fn.toUpperCase()} ${key}: ${v.reason}`);
  } catch (e) {
    handled.delete(key); // retry on next poll
    log(`error handling ${key}:`, e.message);
  }
}

async function poll() {
  try {
    const latest = await pub.getBlockNumber();
    if (fromBlock === 0n) fromBlock = latest - 100n > 0n ? latest - 100n : 0n;
    if (latest < fromBlock) return;
    const created = await pub.getLogs({ address: FACTORY_ADDRESS, event: vaultCreatedEvent, fromBlock, toBlock: latest });
    for (const l of created) {
      if (l.args.guardian?.toLowerCase() === account.address.toLowerCase()) {
        if (!vaults.has(l.args.vault)) log("guarding new vault", l.args.vault);
        vaults.add(l.args.vault);
      }
    }
    if (vaults.size) {
      const proposed = await pub.getLogs({ address: [...vaults], event: proposedEvent, fromBlock, toBlock: latest });
      for (const l of proposed) handleProposal(l.address, l.args.id);
    }
    fromBlock = latest + 1n;
  } catch (e) {
    log("poll error:", e.message);
  }
}

// Bootstrap: find all pre-existing vaults guarded by us, and any pending proposals.
async function bootstrap() {
  try {
    const logs = await pub.getLogs({ address: FACTORY_ADDRESS, event: vaultCreatedEvent, fromBlock: 0n, toBlock: "latest" });
    for (const l of logs)
      if (l.args.guardian?.toLowerCase() === account.address.toLowerCase()) vaults.add(l.args.vault);
    log(`bootstrapped: guarding ${vaults.size} vault(s)`);
    for (const vault of vaults) {
      const n = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "proposalCount" });
      for (let i = 0n; i < n; i++) handleProposal(vault, i);
    }
  } catch (e) {
    log("bootstrap error (will rely on polling):", e.message);
  }
}

// Tiny API for the frontend: the guardian's decision feed.
http
  .createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/health") return res.end(JSON.stringify({ ok: true, guardian: account.address, vaults: vaults.size }));
    if (url.pathname === "/decisions") {
      const vault = url.searchParams.get("vault")?.toLowerCase();
      const out = vault ? decisions.filter((d) => d.vault.toLowerCase() === vault) : decisions;
      return res.end(JSON.stringify(out.slice(-50)));
    }
    res.statusCode = 404;
    res.end("{}");
  })
  .listen(Number(PORT), () => log(`guardian ${account.address} listening on :${PORT}`));

await bootstrap();
setInterval(poll, Number(POLL_MS));
log("watching factory", FACTORY_ADDRESS, "on", RPC_URL);
