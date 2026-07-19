// WalletConnect integration: the vault becomes the wallet a dapp talks to.
// Transaction requests from the dapp are routed into vault.propose(), so the
// guardian reviews everything a dapp asks for before it can execute.
import { Core } from "@walletconnect/core";
import { WalletKit } from "@reown/walletkit";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";
import { chain } from "./chain.js";

export const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID ?? "";

let kit = null;

export async function initWalletKit() {
  if (kit || !WC_PROJECT_ID) return kit;
  const core = new Core({ projectId: WC_PROJECT_ID });
  kit = await WalletKit.init({
    core,
    metadata: {
      name: "Second Signature",
      description: "The wallet that argues back",
      url: "https://secondsignature.vercel.app",
      icons: ["https://secondsignature.vercel.app/favicon.svg"],
    },
  });
  return kit;
}

// Pair with a dapp using a wc: URI. onRequest(request) is called for every
// session request; it must return a result or throw.
export async function connectDapp(uri, vault, handlers) {
  const k = await initWalletKit();
  if (!k) throw new Error("WalletConnect is not configured");

  k.on("session_proposal", async (proposal) => {
    try {
      const namespaces = buildApprovedNamespaces({
        proposal: proposal.params,
        supportedNamespaces: {
          eip155: {
            chains: [`eip155:${chain.id}`],
            methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData", "eth_signTypedData_v4"],
            events: ["accountsChanged", "chainChanged"],
            accounts: [`eip155:${chain.id}:${vault}`],
          },
        },
      });
      const session = await k.approveSession({ id: proposal.id, namespaces });
      handlers.onSession(session);
    } catch (e) {
      await k.rejectSession({ id: proposal.id, reason: getSdkError("UNSUPPORTED_CHAINS") });
      handlers.onError(`This dapp needs a network the vault does not live on. ${e.message}`);
    }
  });

  k.on("session_request", async (event) => {
    const { topic, params, id } = event;
    const { request } = params;
    try {
      if (request.method === "eth_sendTransaction") {
        const tx = request.params[0];
        const hash = await handlers.onTransaction(tx);
        await k.respondSessionRequest({ topic, response: { id, jsonrpc: "2.0", result: hash } });
      } else {
        // Message signing cannot be guardian-reviewed on-chain yet, so we
        // decline rather than fake it.
        handlers.onError("A dapp asked for a message signature. The vault only handles transactions for now, so it said no.");
        await k.respondSessionRequest({
          topic,
          response: { id, jsonrpc: "2.0", error: { code: 4001, message: "Second Signature vaults only sign transactions reviewed by the guardian." } },
        });
      }
    } catch (e) {
      await k.respondSessionRequest({
        topic,
        response: { id, jsonrpc: "2.0", error: { code: 4001, message: e.shortMessage ?? e.message } },
      });
    }
  });

  await k.pair({ uri });
  return k;
}

export async function disconnectAll() {
  if (!kit) return;
  const sessions = kit.getActiveSessions();
  for (const s of Object.values(sessions)) {
    await kit.disconnectSession({ topic: s.topic, reason: getSdkError("USER_DISCONNECTED") }).catch(() => {});
  }
}
