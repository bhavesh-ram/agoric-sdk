#!/bin/bash

set -euo pipefail
shopt -s expand_aliases

alias osmosis-cli="kubectl exec -i osmosislocal-genesis-0 -c validator -- /bin/bash -c"
alias osmosis-exec="kubectl exec -i osmosislocal-genesis-0 -c validator -- osmosisd"

SWAPROUTER_OWNER_WALLET="genesis"
SWAPROUTER_OWNER_ADDRESS=$(osmosis-exec keys show ${SWAPROUTER_OWNER_WALLET} -a)
SWAPROUTER_ADDRESS=$(osmosis-cli "jq -r '.swaprouter.address' /contract-info.json")


echo "SWAPROUTER_OWNER_ADDRESS: $SWAPROUTER_OWNER_ADDRESS"
echo "Denom 1: $1"
echo "Denom 2: $2"
echo "SWAPROUTER_ADDRESS: $SWAPROUTER_ADDRESS"

GET_ROUTE_JSON=$(jq -n \
  --arg tokenIn "ibc/$1" \
  '{
  "get_route": {
    "input_denom": $tokenIn,
    "output_denom": "uosmo"
  }
}')

echo "Command: osmosis-exec query wasm contract-state smart $SWAPROUTER_ADDRESS $GET_ROUTE_JSON"
DENOM_1_POOL_ID=$(osmosis-exec query wasm contract-state smart "$SWAPROUTER_ADDRESS" "$GET_ROUTE_JSON" | jq -r '.data.pool_route[0].pool_id')
echo "DENOM_1_POOL_ID: $DENOM_1_POOL_ID"

GET_ROUTE_JSON=$(jq -n \
  --arg tokenIn "ibc/$2" \
  '{
  "get_route": {
    "input_denom": $tokenIn,
    "output_denom": "uosmo"
  }
}')

echo "Command: osmosis-exec query wasm contract-state smart $SWAPROUTER_ADDRESS $GET_ROUTE_JSON"
DENOM_2_POOL_ID=$(osmosis-exec query wasm contract-state smart "$SWAPROUTER_ADDRESS" "$GET_ROUTE_JSON" | jq -r '.data.pool_route[0].pool_id')
echo "DENOM_2_POOL_ID: $DENOM_2_POOL_ID"

SET_ROUTE_JSON=$(jq -n \
  --arg tokenIn "ibc/$1" \
  --arg tokenOut "ibc/$2" \
  --arg poolId1 "$DENOM_1_POOL_ID" \
  --arg poolId2 "$DENOM_2_POOL_ID" \
  '{
    set_route: {
      input_denom: $tokenIn,
      output_denom: $tokenOut,
      pool_route: [
        {
          pool_id: $poolId1,
          token_out_denom: "uosmo"
        },
        {
          pool_id: $poolId2,
          token_out_denom: $tokenOut
        }
      ]
    }
  }')

osmosis-exec tx wasm execute "$SWAPROUTER_ADDRESS" "$SET_ROUTE_JSON" --from $SWAPROUTER_OWNER_ADDRESS --yes --fees 4000uosmo