# see https://github.com/cosmology-tech/starship/blob/0e18757b8393357fc66426c5ee23da4ccf760e74/examples/getting-started/Makefile

NAME = agoric-multichain-testing
FILE = config.yaml

HELM_REPO = starship
HELM_CHART = devnet
HELM_VERSION = v0.2.20

###############################################################################
###                              All commands                               ###
###############################################################################

.PHONY: setup
setup: setup-deps setup-kind

.PHONY: stop
stop: stop-forward delete

.PHONY: clean
clean: stop clean-kind

###############################################################################
###                          Dependency check                               ###
###############################################################################

.PHONY: check
setup-deps:
	$(CURDIR)/scripts/dev-setup.sh

###############################################################################
###                              Helm Charts                                ###
###############################################################################

install:
	$(CURDIR)/scripts/install.sh --config $(FILE) --name $(NAME) --version $(HELM_VERSION)

delete:
	-helm repo remove $(HELM_REPO)
	-helm delete $(NAME)

###############################################################################
###                                 Port forward                            ###
###############################################################################

.PHONY: port-forward
port-forward:
	$(CURDIR)/scripts/port-forward.sh --config=$(FILE)

.PHONY: stop-forward
stop-forward:
	-pkill -f "port-forward"

###############################################################################
###                          Local Kind Setup                               ###
###############################################################################
KIND_CLUSTER=agship

.PHONY: setup-kind
setup-kind:
	kind create cluster --name $(KIND_CLUSTER)

.PHONY: clean-kind
clean-kind:
	-kind delete cluster --name $(KIND_CLUSTER)

###############################################################################
###                          Agoric Setup                                   ###
###############################################################################

# add address
add-address:
	kubectl exec -i agoriclocal-genesis-0 -c validator -- agd keys add user1

fund-provision-pool:
	scripts/fund-provision-pool.ts

register-bank-assets:
	scripts/fetch-starship-chain-info.ts && \
	scripts/deploy-cli.ts src/register-interchain-bank-assets.builder.js \
		assets="$$(scripts/make-bank-asset-info.ts)"

ADDR=agoric1ldmtatp24qlllgxmrsjzcpe20fvlkp448zcuce
COIN=1000000000uist

fund-wallet:
	kubectl exec -i agoriclocal-genesis-0 -c validator -- agd tx bank send faucet $(ADDR) $(COIN) -y -b block

provision-smart-wallet:
	kubectl exec -i agoriclocal-genesis-0 -c validator -- agd tx swingset provision-one wallet $(ADDR) SMART_WALLET --from $(ADDR) -y -b block

# view agoric swingset logs from slog file, until we can set `DEBUG=SwingSet:vat,SwingSet:ls`
tail-slog:
	kubectl exec -i agoriclocal-genesis-0 -c validator -- tail -f slog.slog


###############################################################################
###                          Osmosis Setup                                   ###
###############################################################################
osmosis-xcs-setup:
	$(CURDIR)/scripts/setup-xcs.sh

create-osmosis-pool:
	$(CURDIR)/scripts/create-osmosis-pool.sh

###############################################################################
###                           Start All                                     ###
###############################################################################

.PHONY: wait-for-pods
wait-for-pods:
	scripts/pod-readiness.ts

.PHONY: start
start: install wait-for-pods port-forward fund-provision-pool register-bank-assets

