import {
  createFundedWalletAndClient,
  makeIBCTransferMsg,
} from '../../tools/ibc-transfer.js';
import { execa } from 'execa';
import path from 'path';
import { fileURLToPath } from 'url';

export const fundRemote = async (
  t,
  destinationChain,
  denomToTransfer = 'ubld',
  amount = 100000000n,
) => {
  const { retryUntilCondition, useChain } = t.context;

  const { client, address, wallet } = await createFundedWalletAndClient(
    t.log,
    destinationChain,
    useChain,
  );
  const balancesResult = await retryUntilCondition(
    () => client.getAllBalances(address),
    coins => !!coins?.length,
    `Faucet balances found for ${address}`,
  );
  console.log('Balances:', balancesResult);

  const { client: agoricClient, address: agoricAddress } =
    await createFundedWalletAndClient(t.log, 'agoric', useChain);

  const balancesResultAg = await retryUntilCondition(
    () => agoricClient.getAllBalances(agoricAddress),
    coins => !!coins?.length,
    `Faucet balances found for ${agoricAddress}`,
  );
  console.log('Balances AGORIC:', balancesResultAg);

  const transferArgs = makeIBCTransferMsg(
    { denom: denomToTransfer, value: amount },
    { address, chainName: destinationChain },
    { address: agoricAddress, chainName: 'agoric' },
    Date.now(),
    useChain,
  );
  console.log('Transfer Args:', transferArgs);
  // TODO #9200 `sendIbcTokens` does not support `memo`
  // @ts-expect-error spread argument for concise code
  const txRes = await agoricClient.sendIbcTokens(...transferArgs);
  if (txRes && txRes.code !== 0) {
    console.error(txRes);
    throw Error(`failed to ibc transfer funds to ${denomToTransfer}`);
  }
  const { events: _events, ...txRest } = txRes;
  console.log(txRest);
  t.is(txRes.code, 0, `Transaction succeeded`);
  t.log(`Funds transferred to ${agoricAddress}`);

  await retryUntilCondition(
    () => client.getAllBalances(address),
    coins => !!coins?.length,
    `${denomToTransfer} transferred to ${address}`,
  );

  return {
    client,
    address,
    wallet,
  };
};

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export const setupXcsContracts = async t => {
  console.log('Setting XCS Contracts ...');
  const osmosisBranch = 'main';
  try {
    const scriptPath = path.resolve(dirname, '../../scripts/setup-xcs.sh');
    const { stdout } = await execa(scriptPath, [osmosisBranch]);
    console.log('setup-xcs script output:', stdout);
  } catch (error) {
    t.fail(`setup-xcs script failed with error: ${error}`);
  }
};

export const createOsmosisPool = async t => {
  console.log('Creating Osmosis Pool ...');
  const tokenInDenom = 'ubld';
  const tokenInAmount = '250000';
  const tokenInWeight = '1';
  const tokenOutDenom = 'uosmo';
  const tokenOutAmount = '250000';
  const tokenOutWeight = '1';
  try {
    const scriptPath = path.resolve(
      dirname,
      '../../scripts/create-osmosis-pool.sh',
    );
    const { stdout } = await execa(scriptPath, [
      tokenInDenom,
      tokenInAmount,
      tokenInWeight,
      tokenOutDenom,
      tokenOutAmount,
      tokenOutWeight,
    ]);
    console.log('create-osmosis-pool  script output:', stdout);
  } catch (error) {
    t.fail(`create-osmosis-pool failed with error: ${error}`);
  }
};

export const createOsmosisPoolFlix = async t => {
  console.log('Creating Osmosis Pool Flix ...');
  const tokenInDenom = 'uflix';
  const tokenInAmount = '250000';
  const tokenInWeight = '1';
  const tokenOutDenom = 'uosmo';
  const tokenOutAmount = '250000';
  const tokenOutWeight = '1';
  try {
    const scriptPath = path.resolve(
      dirname,
      '../../scripts/create-osmosis-pool-flix.sh',
    );
    const { stdout } = await execa(scriptPath, [
      tokenInDenom,
      tokenInAmount,
      tokenInWeight,
      tokenOutDenom,
      tokenOutAmount,
      tokenOutWeight,
    ]);
    console.log('create-osmosis-pool-flix script output:', stdout);
  } catch (error) {
    t.fail(`create-osmosis-pool-flix failed with error: ${error}`);
  }
};

export const createOsmosisPoolAtom = async t => {
  console.log('Creating Osmosis Pool Atom ...');
  const tokenInDenom = 'uatom';
  const tokenInAmount = '250000';
  const tokenInWeight = '1';
  const tokenOutDenom = 'uosmo';
  const tokenOutAmount = '250000';
  const tokenOutWeight = '1';
  try {
    const scriptPath = path.resolve(
      dirname,
      '../../scripts/create-osmosis-pool-atom.sh',
    );
    const { stdout } = await execa(scriptPath, [
      tokenInDenom,
      tokenInAmount,
      tokenInWeight,
      tokenOutDenom,
      tokenOutAmount,
      tokenOutWeight,
    ]);
    console.log('create-osmosis-pool-atom script output:', stdout);
  } catch (error) {
    t.fail(`create-osmosis-pool-atom failed with error: ${error}`);
  }
};

export const setupXcsChannelLink = async (t, chainA, chainB) => {
  console.log('Setting XCS Channel Links ...');
  try {
    const scriptPath = path.resolve(
      dirname,
      '../../scripts/setup-xcs-channel-link.sh',
    );
    const { stdout } = await execa(scriptPath, [chainA, chainB]);
    console.log('channel link setup output:', stdout);
  } catch (error) {
    t.fail(`channel link setup failed with error: ${error}`);
  }
};

export const setupRoutes = async (t, denom1, denom2) => {
  console.log('Setting XCS Routes ...');
  try {
    const scriptPath = path.resolve(
      dirname,
      '../../scripts/setup-xcs-routes.sh',
    );
    const { stdout } = await execa(scriptPath, [denom1, denom2]);
    console.log('routes setup output:', stdout);
  } catch (error) {
    t.fail(`routes setup failed with error: ${error}`);
  }
};

export const setupXcsPrefix = async t => {
  console.log('Setting XCS Prefixes ...');
  try {
    const scriptPath = path.resolve(
      dirname,
      '../../scripts/setup-xcs-prefix.sh',
    );
    const { stdout } = await execa(scriptPath);
    console.log('prefix setup output:', stdout);
  } catch (error) {
    t.fail(`prefix setup failed with error: ${error}`);
  }
};

export const getXcsContractsAddress = async () => {
  const osmosisCLI =
    'kubectl exec -i osmosislocal-genesis-0 -c validator -- /bin/bash -c';

  const registryQuery = `${osmosisCLI} "jq -r '.crosschain_registry.address' /contract-info.json"`;
  const swaprouterQuery = `${osmosisCLI} "jq -r '.swaprouter.address' /contract-info.json"`;
  const swapQuery = `${osmosisCLI} "jq -r '.crosschain_swaps.address' /contract-info.json"`;

  const { stdout: registryAddress } = await execa(registryQuery, {
    shell: true,
  });
  const { stdout: swaprouterAddress } = await execa(swaprouterQuery, {
    shell: true,
  });
  const { stdout: swapAddress } = await execa(swapQuery, { shell: true });

  return { registryAddress, swaprouterAddress, swapAddress };
};

export const getXcsState = async () => {
  const { registryAddress } = await getXcsContractsAddress();

  const osmosisExecQuery =
    'kubectl exec -i osmosislocal-genesis-0 -c validator -- osmosisd query wasm contract-state smart';

  const channelObj = {
    get_channel_from_chain_pair: {
      source_chain: 'osmosis',
      destination_chain: 'agoric',
    },
  };
  const channelJson = `'${JSON.stringify(channelObj)}'`;
  const channelQuery = `${osmosisExecQuery} ${registryAddress} ${channelJson}`;

  const { stdout: channel } = await execa(channelQuery, {
    shell: true,
  });

  const prefixObj = {
    get_bech32_prefix_from_chain_name: {
      chain_name: 'osmosis',
    },
  };
  const prefixJson = `'${JSON.stringify(prefixObj)}'`;
  const prefixQuery = `${osmosisExecQuery} ${registryAddress} ${prefixJson}`;

  const { stdout: prefix } = await execa(prefixQuery, {
    shell: true,
  });

  const channelData = JSON.parse(channel).data;
  const prefixData = JSON.parse(prefix).data;

  return { channelData, prefixData };
};

export const getPoolRoute = async () => {
  const { swaprouterAddress } = await getXcsContractsAddress();

  const osmosisExecQuery =
    'kubectl exec -i osmosislocal-genesis-0 -c validator -- osmosisd query wasm contract-state smart';

  const routeObj = {
    get_route: {
      input_denom: 'ibc/49C630713B2AB60653F76C0C58D43C2A64956803B4D422CACB6DD4AD016ED846',
      output_denom:
        'uosmo',
    },
  };
  const routeJson = `'${JSON.stringify(routeObj)}'`;
  const routeQuery = `${osmosisExecQuery} ${swaprouterAddress} ${routeJson}`;

  const { stdout } = await execa(routeQuery, {
    shell: true,
  });

  const routeData = JSON.parse(stdout).data;
  const route = routeData.pool_route[routeData.pool_route.length - 1];

  return route;
};

export const getPool = async poolId => {
  const osmosisExec =
    'kubectl exec -i osmosislocal-genesis-0 -c validator -- osmosisd';

  const poolQuery = `${osmosisExec} query gamm pool ${poolId}`;

  const { stdout } = await execa(poolQuery, {
    shell: true,
  });

  const pool = JSON.parse(stdout).pool;

  return pool;
};