import { defineChain } from "viem";

// Config via Vite env, with local-dev fallbacks (anvil).
export const FACTORY_ADDRESS = import.meta.env.VITE_FACTORY_ADDRESS ?? "0x8464135c8F25Da09e49BC8782676a84730C318bC";
export const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? "http://localhost:8787";
export const EXPLORER = import.meta.env.VITE_EXPLORER ?? "https://monadscan.com";

export const chain = defineChain({
  id: Number(import.meta.env.VITE_CHAIN_ID ?? 31337),
  name: import.meta.env.VITE_CHAIN_NAME ?? "Local Anvil",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_RPC_URL ?? "http://localhost:8545"] } },
  blockExplorers: { default: { name: "Monadscan", url: EXPLORER } },
});

export const factoryAbi = [
  { type: "function", name: "createVault", stateMutability: "nonpayable", inputs: [{ name: "guardian", type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "vaultsOf", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "vaultCountOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalVaults", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "defaultGuardian", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

export const vaultAbi = [
  { type: "function", name: "propose", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "forceExecute", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "proposalCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "proposals", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "proposedAt", type: "uint64" }, { name: "status", type: "uint8" }] },
  { type: "function", name: "guardian", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "OVERRIDE_DELAY", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
];

export const STATUS = ["Pending", "Executed", "Rejected", "Cancelled"];
