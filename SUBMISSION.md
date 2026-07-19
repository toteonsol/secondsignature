# Spark submission kit

Everything below is ready to paste into the BuildAnything submission form.

## Name
Second Signature

## Description
A self-custodial wallet on Monad where you never sign alone. Every transaction, whether you send it yourself or a dapp requests it, needs two signatures: yours, and an AI guardian's. The guardian reads the transaction against live on-chain context and either co-signs or argues back in plain English, with its reasoning recorded on-chain.

## Problem
The biggest threat to a crypto wallet is its owner. One mistyped address, one signed drain, one bad night, and the money is gone forever. I have fat-fingered transfers myself, and everyone in crypto knows someone who lost funds to a mistake no bank would have let through. Banks have fraud departments. Wallets have nothing.

## Solution
Second Signature gives your wallet a second pair of eyes with real authority but zero power to steal. Funds live in your own vault contract. Withdrawals are proposals: you sign first, then a guardian agent studies the destination's history, the amount against your balance, and the calldata, and it co-signs or objects in plain English. Its signature alone moves nothing, and it can never lock you out: any proposal can be pushed through by you alone after 48 hours, which is exactly the delay that defeats a thief holding your key. It also speaks WalletConnect, so the vault can be your wallet on any dapp with the guardian reviewing everything the dapp asks for.

## Project URL
https://secondsignature.web3wikis.com

## Github repo
https://github.com/toteonsol/secondsignature

## Category
Monad Mainnet

## Contract address
0x8c58EdE67E93e15e371cFbd3C0b197c4971C2db2

## Demo video (3 min, shot by shot)

1. (0:00-0:20) Landing page on screen, read the headline as your hook: "Never sign alone again. The biggest threat to my wallet has always been me, so I gave it a second signer with a mind of its own." Let the two ink strokes counter-sign under the headline.
2. (0:20-0:45) Connect wallet, create a vault, deposit a little MON. Point at the guardian pill showing online.
3. (0:45-1:20) Send a small amount to an address with real history (your own main wallet works). Watch the guardian co-sign in seconds and the transfer execute. Click the Monadscan link to show the reasoning stored on-chain. Line: "It approves what looks normal, fast."
4. (1:20-2:10) The money shot: send 90% of the vault to a fresh address. The guardian objects and lectures you, on screen, in its own words. Show the proposal marked REJECTED and the override locked for 48 hours. Line: "It can never lock me out, but a thief with my key can't wait out 48 public hours."
5. (2:10-2:45) The core: on a real Monad dapp (or the WalletConnect demo dapp), choose WalletConnect and paste the code into Second Signature. Show "Connected". Line: "This is the heart of it. Connect any dapp, even a scam, and everything it asks goes past my guardian before it can touch my money. I never sign alone, anywhere."
6. (2:45-3:00) Close: "Self-custodial, one guardian for every vault, live on Monad mainnet today. Second Signature: the wallet that argues back."

Recording tips: record in one take if you can, keep the wallet popups visible, and let the guardian's objection text stay on screen long enough to read. That text is the product.

## Social post (X)

My wallet just refused to obey me.

I proposed sending 90% of my balance to a fresh address and it objected, in writing, on-chain: "this screams scam collector wallet. If I'm wrong, override me in 48 hours."

I built Second Signature this weekend for @monad_xyz's Spark hackathon: a vault where an AI co-signs every withdrawal. It can't steal (its signature alone moves nothing) and it can't lock you out (you win after 48h, which is exactly what defeats a thief with your key).

Live on Monad mainnet: secondsignature.web3wikis.com

The wallet that argues back.

## Judge questions you should be ready for

- "What if your Railway server dies?" The vault still works: nothing can be stolen, and the owner can force any transaction after 48 hours. The guardian is a speed bump with judgment, not a custodian.
- "What if the LLM hallucinates?" Worst case it objects wrongly, which costs the owner a 48 hour wait or a cancel. It cannot approve alone; approval only executes what the owner already signed.
- "Why would anyone trust your guardian?" They do not have to. The trust is bounded by construction: delay, never denial. And the factory accepts any guardian address, so a registry of independent guardians is the roadmap.
- "Is the AI real?" Yes: each verdict is an LLM call with live on-chain context, and the reasoning lands on-chain in the approve/object transaction. Check any objection tx on Monadscan.
