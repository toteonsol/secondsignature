#!/usr/bin/env bash
# Deploy VaultFactory to Monad mainnet.
# Usage:
#   export DEPLOYER_KEY=0x...      # a funded Monad mainnet key (yours)
#   export GUARDIAN_ADDRESS=0x...  # the guardian agent's public address
#   ./deploy.sh
set -euo pipefail

RPC=${RPC:-https://rpc.monad.xyz}

forge create src/VaultFactory.sol:VaultFactory \
  --rpc-url "$RPC" \
  --private-key "$DEPLOYER_KEY" \
  --broadcast \
  --constructor-args "$GUARDIAN_ADDRESS"

echo "Now verify (optional but recommended):"
echo "forge verify-contract <deployed_address> src/VaultFactory.sol:VaultFactory --chain 143 --verifier sourcify --constructor-args \$(cast abi-encode 'constructor(address)' $GUARDIAN_ADDRESS)"
