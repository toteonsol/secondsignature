# Second Signature

**The wallet that argues back.**

Live app: https://secondsignature.web3wikis.com
Factory on Monad mainnet: [`0x8c58EdE67E93e15e371cFbd3C0b197c4971C2db2`](https://monadscan.com/address/0x8c58EdE67E93e15e371cFbd3C0b197c4971C2db2)
Guardian agent: https://secondsignature-production.up.railway.app/health

Second Signature is a self-custodial vault on Monad where every withdrawal needs two signatures: yours, and an AI guardian's. The guardian's only job is to protect you from irreversible mistakes: drains, fat-fingered amounts, phishing destinations, 3am panic moves. It reviews every proposed transaction against live on-chain context and either co-signs or objects, and its reasoning is stored on-chain with the decision.

## The problem

The biggest threat to a crypto wallet is usually its own owner. One mistyped address, one signed drain, one bad night, and the money is gone forever. Banks have fraud departments. Wallets have nothing.

## The solution

A two-of-two vault where the second signer is an AI agent with a very specific deal:

- **It can't steal.** The guardian's signature alone moves nothing. Funds live in your own contract, owned by your key.
- **It can't lock you out.** Any proposal, even one the guardian rejected, can be executed by you alone after a 48 hour delay.
- **The delay is the shield.** A thief holding your key can't quietly wait out 48 public hours.
- Swapping the guardian is also timelocked, so a stolen key can't just replace the guardian and drain.

One hosted guardian serves every vault. Nobody needs to run anything.

## Use it on any dapp (beta)

The vault speaks WalletConnect. On any dapp, pick WalletConnect, paste the pairing code into Second Signature, and the vault becomes your wallet there. Every transaction the dapp requests lands in your proposals queue and executes only after the guardian co-signs. Why it matters: the classic wallet drain is a dapp asking for a signature you did not understand, and now something is reading it before it can hurt you.

## Architecture

```
contracts/   GuardianVault + VaultFactory (Solidity, Foundry, 9 passing tests)
agent/       Guardian service (Node + viem + Claude). Watches Proposed events,
             gathers on-chain context, decides, then calls approve() or object()
             with its reasoning as calldata. Falls back to deterministic
             heuristics if the LLM is unreachable.
web/         React + viem frontend. Create a vault, deposit, propose, and read
             the guardian's argument feed.
```

## Run it locally

```bash
# 1. chain + contracts
anvil &
cd contracts && forge test && forge create src/VaultFactory.sol:VaultFactory \
  --rpc-url http://localhost:8545 --broadcast \
  --private-key <anvil key 1> --constructor-args <guardian address>

# 2. guardian agent
cd agent && npm i
GUARDIAN_PRIVATE_KEY=<key> FACTORY_ADDRESS=<factory> RPC_URL=http://localhost:8545 \
  CHAIN_ID=31337 ANTHROPIC_API_KEY=<optional> npm start

# 3. web
cd web && npm i && npm run dev
```

## Deploy (Monad mainnet)

Chain id 143, RPC https://rpc.monad.xyz. See `contracts/deploy.sh` for the two-command deploy, `agent/.env.example` and `web/.env.example` for configuration.

## Security model in one paragraph

The owner is the only party who can propose, cancel, or force-execute. The guardian is the only party who can approve or object, and both of those act on existing proposals only. Force-execution requires `OVERRIDE_DELAY` (48h) to have passed since the proposal. Guardian rotation goes through the same delay. There is no upgrade mechanism, no admin, and no path by which the factory, the agent operator, or anyone else touches funds in a vault.
