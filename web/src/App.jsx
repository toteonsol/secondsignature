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
        <section className="hero">
          <h2>Your wallet's other signer is an AI whose only job is to protect you from yourself.</h2>
          <p>
            Every withdrawal needs two signatures: yours and your guardian's. The guardian can't spend a thing on its own.
            It can only agree, or push back and tell you why. And it can never lock you out: after 48 hours, your signature alone is enough.
          </p>
          <button onClick={connect}>Connect a wallet to begin</button>
        </section>
      )}

      {account && !vault && (
        <section className="hero">
          <h2>Create your vault</h2>
          <p>A personal contract on Monad, owned by you, co-signed by the guardian agent.</p>
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
