import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatEther, parseEther, http as viemHttp } from "viem";
import { chain, factoryAbi, vaultAbi, FACTORY_ADDRESS, AGENT_URL, EXPLORER, STATUS } from "./chain.js";
import { connectDapp, disconnectAll, WC_PROJECT_ID } from "./walletconnect.js";

const pub = createPublicClient({ chain, transport: viemHttp() });

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export default function App() {
  const [account, setAccount] = useState(null);
  const [vault, setVault] = useState(null);
  const [balance, setBalance] = useState(0n);
  const [proposals, setProposals] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [guardianOnline, setGuardianOnline] = useState(null);
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ to: "", amount: "" });
  const [deposit, setDeposit] = useState("");
  const [wcUri, setWcUri] = useState("");
  const [wcSession, setWcSession] = useState(null);
  const [wcNote, setWcNote] = useState("");
  const [landing, setLanding] = useState({ vaults: null, verdicts: null, quote: null });

  useEffect(() => {
    (async () => {
      try {
        const [vaults, all] = await Promise.all([
          pub.readContract({ address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "totalVaults" }),
          fetch(`${AGENT_URL}/decisions`).then((r) => r.json()),
        ]);
        const quote = [...all].reverse().find((d) => !d.approved) ?? all[all.length - 1] ?? null;
        setLanding({ vaults: Number(vaults), verdicts: all.length, quote });
      } catch { /* landing works without stats */ }
    })();
  }, []);

  const [wallet, setWallet] = useState(null);

  const connect = async () => {
    if (!window.ethereum) return alert("No wallet found. Install MetaMask (or any injected wallet).");
    const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
    setWallet(wallet);
    const [addr] = await wallet.requestAddresses();
    try {
      await wallet.switchChain({ id: chain.id });
    } catch {
      await wallet.addChain({ chain }).catch(() => {});
    }
    setAccount(addr);
  };

  const refresh = useCallback(async () => {
    try {
      const h = await fetch(`${AGENT_URL}/health`).then((r) => r.json());
      setGuardianOnline(h.guardian);
    } catch {
      setGuardianOnline(false);
    }
    if (!account) return;
    if (!vault) {
      const n = await pub.readContract({ address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "vaultCountOf", args: [account] });
      if (n > 0n) {
        const v = await pub.readContract({ address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "vaultsOf", args: [account, n - 1n] });
        setVault(v);
      }
      return;
    }
    const [bal, count] = await Promise.all([
      pub.getBalance({ address: vault }),
      pub.readContract({ address: vault, abi: vaultAbi, functionName: "proposalCount" }),
    ]);
    setBalance(bal);
    const ps = await Promise.all(
      Array.from({ length: Number(count) }, (_, i) =>
        pub.readContract({ address: vault, abi: vaultAbi, functionName: "proposals", args: [BigInt(i)] }).then((p) => ({ id: i, to: p[0], value: p[1], proposedAt: Number(p[3]), status: p[4] }))
      )
    );
    setProposals(ps.reverse());
    try {
      const d = await fetch(`${AGENT_URL}/decisions?vault=${vault}`).then((r) => r.json());
      setDecisions(d.reverse());
    } catch { /* agent offline; on-chain state still shown */ }
  }, [account, vault]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const tx = async (label, fn) => {
    setBusy(label);
    try {
      const hash = await fn();
      await pub.waitForTransactionReceipt({ hash });
      await refresh();
    } catch (e) {
      alert(e.shortMessage ?? e.message);
    } finally {
      setBusy("");
    }
  };

  const createVault = () =>
    tx("create", () =>
      wallet.writeContract({ account, address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "createVault", args: ["0x0000000000000000000000000000000000000000"] })
    ).then(() => setVault(null));

  const fund = () =>
    tx("fund", () => wallet.sendTransaction({ account, to: vault, value: parseEther(deposit || "0") })).then(() => setDeposit(""));

  const propose = () =>
    tx("propose", () =>
      wallet.writeContract({ account, address: vault, abi: vaultAbi, functionName: "propose", args: [form.to, parseEther(form.amount || "0"), "0x"] })
    ).then(() => setForm({ to: "", amount: "" }));

  const act = (fn, id) => tx(`${fn}${id}`, () => wallet.writeContract({ account, address: vault, abi: vaultAbi, functionName: fn, args: [BigInt(id)] }));

  const pairDapp = async () => {
    setBusy("wc");
    setWcNote("");
    try {
      await connectDapp(wcUri.trim(), vault, {
        onSession: (s) => {
          setWcSession(s.peer?.metadata?.name ?? "dapp");
          setWcNote(`Connected. Everything ${s.peer?.metadata?.name ?? "this dapp"} asks for now goes past your guardian first.`);
        },
        onError: (m) => setWcNote(m),
        onTransaction: async (dappTx) => {
          const hash = await wallet.writeContract({
            account,
            address: vault,
            abi: vaultAbi,
            functionName: "propose",
            args: [dappTx.to, BigInt(dappTx.value ?? 0), dappTx.data ?? "0x"],
          });
          await pub.waitForTransactionReceipt({ hash });
          setWcNote("The dapp's request is in your proposals queue. It executes once the guardian co-signs.");
          refresh();
          return hash;
        },
      });
      setWcUri("");
    } catch (e) {
      setWcNote(e.shortMessage ?? e.message);
    } finally {
      setBusy("");
    }
  };

  const disconnectWallet = async () => {
    await disconnectAll().catch(() => {});
    setWcSession(null);
    setAccount(null);
    setWallet(null);
    setVault(null);
    setProposals([]);
    setDecisions([]);
  };

  const unpairDapps = async () => {
    await disconnectAll();
    setWcSession(null);
    setWcNote("Disconnected.");
  };

  const decisionFor = (id) => decisions.find((d) => Number(d.id) === id);
  const overrideReady = (p) => Date.now() / 1000 > p.proposedAt + 48 * 3600;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="sigil">✍︎✍︎</span>
          <div>
            <h1>Second Signature</h1>
            <p className="tag">The wallet that argues back.</p>
          </div>
        </div>
        <div className="header-right">
          <span className={`pill ${guardianOnline ? "on" : "off"}`}>
            {guardianOnline ? `guardian ${short(guardianOnline)} · online` : "guardian offline"}
          </span>
          {account ? (
            <span className="pill acct">
              {short(account)}
              <button className="linky" title="Disconnect this wallet from the app" onClick={disconnectWallet}>disconnect</button>
            </span>
          ) : (
            <button onClick={connect}>Connect wallet</button>
          )}
        </div>
      </header>

      {!account && (
        <>
          <section className="hero">
            <h2>Never sign alone again.</h2>
            <svg className="cosign" viewBox="0 0 260 46" aria-hidden="true">
              <path className="stroke-you" d="M8 24 C 40 6, 62 38, 92 20 S 150 10, 168 22 C 180 30, 196 18, 210 22" />
              <path className="stroke-guardian" d="M22 36 C 60 24, 110 44, 158 32 S 228 26, 252 34" />
            </svg>
            <p>
              Every wallet disaster starts the same way: one signature, made alone. The mistyped address. The scam
              dapp's drain dressed up as a mint. The cofounder who empties the treasury. Second Signature gives every
              transaction a second pair of eyes with a mind of its own: an AI co-signer on Monad that reads the
              destination's history, the contract you're really calling, and the fine print you didn't, then signs
              with you or argues back in plain English, before the money moves.
            </p>
            <button onClick={connect}>Connect a wallet to begin</button>
            <p className="dim small">Your first vault takes about thirty seconds and costs nothing but gas. Works with MetaMask and other browser wallets, live on Monad mainnet.</p>
            {landing.vaults !== null && (
              <div className="stats">
                <span><b>{landing.vaults}</b> vault{landing.vaults === 1 ? "" : "s"} guarded on Monad mainnet</span>
                <span className="statdot">·</span>
                <span><b>{landing.verdicts}</b> verdict{landing.verdicts === 1 ? "" : "s"} delivered, every one on-chain</span>
              </div>
            )}
          </section>

          {landing.quote && (
            <section className="ledger">
              <div className="label">From the guardian's ledger, Monad mainnet, unedited</div>
              <blockquote className="bigquote">"{landing.quote.reason}"</blockquote>
              <p className="dim small">
                {landing.quote.approved ? "Co-signed" : "The transaction it refused never executed."}{" "}
                <a className="mono" href={`${EXPLORER}/tx/${landing.quote.tx}`} target="_blank" rel="noreferrer">read it on-chain</a>
              </p>
            </section>
          )}

          <section className="explain">
            <div className="card">
              <div className="label">How it works</div>
              <ol className="steps">
                <li><b>Create your vault.</b> A contract on Monad that only you own. Your money never sits with us.</li>
                <li><b>Deposit what you want protected.</b> Think savings account, with pocket money staying in your normal wallet.</li>
                <li><b>Withdraw with a second opinion.</b> You sign first. The AI guardian studies the transaction and co-signs, or objects and tells you exactly why.</li>
              </ol>
            </div>
            <div className="card">
              <div className="label">Why it is safe to trust</div>
              <ul className="deal">
                <li><b>The guardian can't steal.</b> Its signature alone moves nothing. Ever.</li>
                <li><b>It can't lock you out.</b> If it objects and you disagree, your signature alone wins after 48 hours.</li>
                <li><b>That delay is the point.</b> A thief with your key can't quietly wait out 48 public hours.</li>
                <li><b>Everything is public.</b> The vault code, the guardian's every decision and its reasoning live on-chain where anyone can check them.</li>
              </ul>
            </div>
            <div className="card">
              <div className="label">Who needs a second signature</div>
              <ul className="deal">
                <li><b>Anyone who signs.</b> Connect any dapp through WalletConnect and the vault becomes your wallet there. If the dapp is a scam, its requests hit your guardian before they touch your money.</li>
                <li><b>Anyone who mistypes.</b> Fat-fingered amounts and wrong addresses get caught while they are still reversible, which is to say: before.</li>
                <li><b>Teams and projects.</b> Treasuries die of internal disputes. An incorruptible co-signer that answers to reasons, not politics, means no single person can drain the project in a bad week.</li>
              </ul>
            </div>
          </section>
        </>
      )}

      {account && !vault && (
        <section className="hero">
          <h2>Step 1 of 2: create your vault</h2>
          <p>This deploys your personal vault contract on Monad. You own it, the guardian watches it, and nobody else can ever touch it. Costs a small gas fee, takes a few seconds.</p>
          <button disabled={!!busy} onClick={createVault}>{busy ? "Creating…" : "Create my vault"}</button>
        </section>
      )}

      {vault && (
        <main className="cols">
          <section className="col">
            <div className="card">
              <div className="label">Vault</div>
              <div className="balance">{Number(formatEther(balance)).toLocaleString(undefined, { maximumFractionDigits: 4 })} <span>MON</span></div>
              <a className="mono dim" href={`${EXPLORER}/address/${vault}`} target="_blank" rel="noreferrer">{vault}</a>
              {balance === 0n && <p className="dim small">Step 2 of 2: deposit some MON. Whatever lives in the vault is what the guardian protects.</p>}
              <div className="row">
                <input placeholder="Amount" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
                <button disabled={!!busy || !deposit} onClick={fund}>Deposit</button>
              </div>
            </div>

            {WC_PROJECT_ID && (
              <div className="card">
                <div className="label">Before you trust another dapp <span className="beta">beta</span></div>
                {wcSession ? (
                  <div className="row spread">
                    <span>Connected to <b>{wcSession}</b>. Everything it asks for goes past your guardian first.</span>
                    <button className="ghost" onClick={unpairDapps}>Disconnect</button>
                  </div>
                ) : (
                  <>
                    <p className="dim small">This is the heart of it: never sign alone, anywhere. On any dapp, choose WalletConnect, copy its pairing code, and paste it here. The vault becomes your wallet on that dapp, and nothing it asks for can execute until your guardian has read it. Scam mints and dressed-up drains die right here.</p>
                    <div className="wc-guide">
                      <svg viewBox="0 0 300 132" aria-label="Where to find the pairing code in a dapp's WalletConnect window">
                        <rect x="60" y="6" width="180" height="120" rx="8" fill="#fffdf7" stroke="#d8c9a8" strokeWidth="1.5" />
                        <text x="150" y="26" textAnchor="middle" fontSize="10" fill="#3a362f" fontFamily="inherit">Connect your wallet</text>
                        <rect x="115" y="36" width="70" height="70" rx="4" fill="none" stroke="#3a362f" strokeWidth="1.5" />
                        {[0,1,2,3,4,5].map((r) => [0,1,2,3,4,5].map((c) => ((r * 7 + c * 3) % 4 < 2) && (
                          <rect key={`${r}-${c}`} x={121 + c * 10} y={42 + r * 10} width="7" height="7" fill="#3a362f" />
                        )))}
                        <g>
                          <rect x="196" y="62" width="16" height="16" rx="3" fill="none" stroke="#3a362f" strokeWidth="1.5" />
                          <rect x="200" y="58" width="16" height="16" rx="3" fill="#fffdf7" stroke="#3a362f" strokeWidth="1.5" />
                          <circle cx="206" cy="68" r="15" fill="none" stroke="#a41f13" strokeWidth="2" strokeDasharray="3 3" />
                          <path d="M222 68 C 244 68, 252 72, 262 84" fill="none" stroke="#a41f13" strokeWidth="1.5" />
                          <text x="230" y="100" fontSize="9" fill="#a41f13" fontStyle="italic" fontFamily="inherit">this one</text>
                        </g>
                      </svg>
                      <p className="dim small">The dapp's WalletConnect window shows a QR code. The pairing code hides behind the small copy icon beside it. Tap it, then paste below.</p>
                    </div>
                    <div className="row">
                      <input placeholder="wc:…" value={wcUri} onChange={(e) => setWcUri(e.target.value)} />
                      <button disabled={!!busy || !wcUri.trim().startsWith("wc:")} onClick={pairDapp}>
                        {busy === "wc" ? "Pairing…" : "Connect"}
                      </button>
                    </div>
                  </>
                )}
                {wcNote && <p className="small note">{wcNote}</p>}
              </div>
            )}

            <div className="card">
              <div className="label">Send from the vault</div>
              <input placeholder="Destination address 0x…" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
              <div className="row">
                <input placeholder="Amount in MON" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                <button disabled={!!busy || !form.to || !form.amount} onClick={propose}>
                  {busy === "propose" ? "Signing…" : "Sign & send to guardian"}
                </button>
              </div>
              <p className="dim small">You sign first, never alone: the guardian reads the destination's history and your own habits, then adds the second signature or argues back.</p>
            </div>

            <div className="card">
              <div className="label">Proposals</div>
              {proposals.length === 0 && <p className="dim">Nothing yet. Propose a withdrawal above and it appears here with the guardian's verdict beside it. Approved ones execute on their own; rejected ones wait for your cancel or your 48 hour override.</p>}
              {proposals.map((p) => (
                <div key={p.id} className={`proposal s${p.status}`}>
                  <div className="row spread">
                    <span className="mono">#{p.id} → {short(p.to)}</span>
                    <span className="amt">{formatEther(p.value)} MON</span>
                    <span className={`status s${p.status}`}>{STATUS[p.status]}</span>
                  </div>
                  {(p.status === 0 || p.status === 2) && (
                    <div className="row">
                      <button className="ghost" disabled={!!busy} onClick={() => act("cancel", p.id)}>Cancel</button>
                      <button className="ghost warn" disabled={!!busy || !overrideReady(p)} onClick={() => act("forceExecute", p.id)}
                        title={overrideReady(p) ? "Execute without the guardian" : "Available 48h after proposal"}>
                        {overrideReady(p) ? "Override guardian" : "Override unlocks in 48h"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="col">
            <div className="card feed">
              <div className="label">The guardian's argument feed</div>
              {decisions.length === 0 && (
                <>
                  <p className="dim">When you propose a withdrawal, the guardian reads the destination's history, the amount against your balance, and the fine print. Its verdict and its exact words show up here, and every word is also recorded on-chain.</p>
                  <p className="dim small">It learns your normal too: destinations you pay regularly earn more benefit of the doubt.</p>
                </>
              )}
              {decisions.map((d) => (
                <div key={d.id + d.tx} className={`verdict ${d.approved ? "ok" : "no"}`}>
                  <div className="verdict-head">
                    <span>{d.approved ? "✓ Co-signed" : "✋ Objection"} · proposal #{d.id}</span>
                    <a className="dim mono" href={`${EXPLORER}/tx/${d.tx}`} target="_blank" rel="noreferrer">{short(d.tx)}</a>
                  </div>
                  <p className="speech">“{d.reason}”</p>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="label">The deal</div>
              <ul className="deal">
                <li><b>It can't steal.</b> The guardian's signature alone moves nothing.</li>
                <li><b>It can't lock you out.</b> Any proposal, even one it rejected, can be pushed through by you alone after 48 hours.</li>
                <li><b>The delay is the shield.</b> A thief with your key can't wait out 48 public hours.</li>
              </ul>
            </div>
          </section>
        </main>
      )}

      <footer className="dim small">
        Second Signature · guardian-co-signed vaults on Monad · self-custodial by construction
      </footer>
    </div>
  );
}
