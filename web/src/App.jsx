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
          {account ? <span className="pill">{short(account)}</span> : <button onClick={connect}>Connect wallet</button>}
        </div>
      </header>

      {!account && (
        <>
          <section className="hero">
            <h2>Give your crypto a guardian with a mind of its own.</h2>
            <p>
              Second Signature is a savings vault where an AI reviews every withdrawal before it can happen.
              It reads the destination's history, the amount, the fine print you didn't. If something looks like
              a drain, a scam, or a 3am mistake, your own wallet argues back, in plain English, before the money moves.
            </p>
            <button onClick={connect}>Connect a wallet to begin</button>
            <p className="dim small">Works with MetaMask and other browser wallets, on Monad mainnet.</p>
          </section>

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
              <div className="label">Use it everywhere</div>
              <p>The vault speaks WalletConnect, the connect option built into most dapps. Pick WalletConnect on any dapp, paste the code here, and the vault becomes your wallet there. Even if the dapp turns out to be a scam, its requests hit your guardian before they can touch your money.</p>
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

            <div className="card">
              <div className="label">Propose a withdrawal</div>
              <input placeholder="Destination address 0x…" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
              <div className="row">
                <input placeholder="Amount in MON" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                <button disabled={!!busy || !form.to || !form.amount} onClick={propose}>
                  {busy === "propose" ? "Signing…" : "Sign & send to guardian"}
                </button>
              </div>
              <p className="dim small">Your signature is the first one. The guardian looks at the details and decides whether to add the second.</p>
            </div>

            {WC_PROJECT_ID && (
              <div className="card">
                <div className="label">Use your vault on any dapp <span className="beta">beta</span></div>
                {wcSession ? (
                  <div className="row spread">
                    <span>Connected to <b>{wcSession}</b></span>
                    <button className="ghost" onClick={unpairDapps}>Disconnect</button>
                  </div>
                ) : (
                  <>
                    <p className="dim small">On the dapp, choose WalletConnect and copy its pairing code, then paste it here. The vault becomes your wallet there, guardian included.</p>
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
              <div className="label">Proposals</div>
              {proposals.length === 0 && <p className="dim">Nothing yet. Your guardian is watching an empty ledger.</p>}
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
              {decisions.length === 0 && <p className="dim">When you propose a withdrawal, the guardian's reasoning shows up here. Every word is also recorded on-chain.</p>}
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
