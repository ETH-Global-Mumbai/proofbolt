// Wallet, contract and replay tools for 0G. Run with: pnpm zerog <command>
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { errorText } from "../log/errors.ts";
import { linkStatus, type ChainedRecord } from "../log/episode.ts";
import { ZeroGNetwork } from "./network.ts";

const USAGE = `Commands:
  wallet    Create a new wallet and print its key
  check     Show the balance, then upload a small test file to 0G Storage and read it back
  deploy    Deploy the DecisionAnchor contract
  replay    Rebuild the decision history from 0G Chain and 0G Storage, and verify it`;

function network(): ZeroGNetwork {
  return new ZeroGNetwork({
    rpcUrl: process.env.OG_CHAIN_RPC,
    chainId: Number(process.env.OG_CHAIN_ID) || undefined,
    privateKey: process.env.OG_PRIVATE_KEY,
    anchorAddress: process.env.OG_ANCHOR_ADDRESS,
  });
}

async function compile(): Promise<{ abi: ethers.InterfaceAbi; bytecode: string }> {
  const { default: solc } = await import("solc");
  const content = readFileSync(new URL("../../../contracts/DecisionAnchor.sol", import.meta.url), "utf8");
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "DecisionAnchor.sol": { content } },
        settings: { evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
      }),
    ),
  );
  const errors = (output.errors ?? []).filter((error: { severity: string }) => error.severity === "error");
  if (errors.length) throw new Error(errors[0].formattedMessage);
  const contract = output.contracts["DecisionAnchor.sol"].DecisionAnchor;
  return { abi: contract.abi, bytecode: contract.evm.bytecode.object };
}

async function replay(): Promise<void> {
  const zerog = network();
  const anchors = await zerog.readAnchors();
  console.log(`${anchors.length} decisions anchored on 0G Chain`);
  let previous: ChainedRecord | null = null;
  let valid = true;
  for (const { recordHash, storageRoot } of anchors) {
    const record = JSON.parse(await zerog.download(storageRoot)) as ChainedRecord;
    const link = linkStatus(record, previous);
    const matches = `0x${record.hash}` === recordHash;
    if (!matches || link === "BROKEN") valid = false;
    if (link === "NEW_LOG") console.log("--- a new log starts here");
    console.log(
      `${record.at}  ${record.challenge || "-"}  AI ${record.decision ?? record.aiStatus}  ` +
        `policy ${record.policy}  lock ${record.lockAck}  request ${record.requestId ?? "-"}` +
        (matches && link !== "BROKEN" ? "" : "  TAMPERED"),
    );
    previous = record;
  }
  console.log(valid ? "Every record matches its anchor and the chain is unbroken" : "VERIFICATION FAILED");
  if (!valid) process.exitCode = 1;
}

async function run(command: string | undefined): Promise<void> {
  switch (command) {
    case "wallet": {
      const wallet = ethers.Wallet.createRandom();
      console.log(`OG_PRIVATE_KEY=${wallet.privateKey}`);
      console.log(`Address: ${wallet.address}`);
      console.log("Put the key in .env and fund the address at https://faucet.0g.ai");
      break;
    }
    case "check": {
      const zerog = network();
      const balance = await zerog.balance();
      console.log(`Wallet ${zerog.signer.address}, balance ${balance} 0G`);
      if (Number(balance) === 0) throw new Error("This wallet has no 0G. Send faucet tokens to the address above");
      const text = `proofbolt check ${new Date().toISOString()}`;
      const { rootHash, txHash } = await zerog.upload(new TextEncoder().encode(text));
      console.log(`Upload: root ${rootHash}, transaction ${txHash}`);
      console.log(`Read back: ${await zerog.download(rootHash)}`);
      break;
    }
    case "deploy": {
      const zerog = network();
      const { abi, bytecode } = await compile();
      const contract = await new ethers.ContractFactory(abi, bytecode, zerog.signer).deploy();
      await contract.waitForDeployment();
      console.log(`OG_ANCHOR_ADDRESS=${await contract.getAddress()}`);
      console.log(`Transaction: ${contract.deploymentTransaction()?.hash}`);
      break;
    }
    case "replay":
      await replay();
      break;
    default:
      console.log(USAGE);
  }
}

try {
  await run(process.argv[2]);
} catch (error) {
  console.error(errorText(error));
  process.exitCode = 1;
}
