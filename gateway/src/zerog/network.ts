// The gateway's link to 0G Storage and 0G Chain, on the Galileo testnet.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";

export const GALILEO_CHAIN_ID = 16602;
export const GALILEO_RPC = "https://evmrpc-testnet.0g.ai";
export const GALILEO_INDEXER = "https://indexer-storage-testnet-turbo.0g.ai";

export const ANCHOR_ABI = [
  "function anchor(bytes32 recordHash, bytes32 storageRoot)",
  "function count() view returns (uint256)",
  "function decisions(uint256) view returns (bytes32 recordHash, bytes32 storageRoot)",
  "function gateway() view returns (address)",
];

export interface AnchoredDecision {
  recordHash: string;
  storageRoot: string;
}

export interface ZeroGOptions {
  rpcUrl?: string;
  chainId?: number;
  indexerUrl?: string;
  /** Needed to write. Replaying the public record doesn't need it. */
  privateKey?: string;
  anchorAddress?: string;
}

export class ZeroGNetwork {
  readonly provider: ethers.JsonRpcProvider;
  private readonly rpcUrl: string;
  private readonly indexer: Indexer;
  private readonly wallet: ethers.Wallet | null;
  private readonly anchorAddress: string | null;

  constructor(options: ZeroGOptions) {
    this.rpcUrl = options.rpcUrl ?? GALILEO_RPC;
    // A fixed network makes an unreachable RPC fail with an error, where ethers would otherwise
    // retry forever and silently stop publishing.
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl, options.chainId ?? GALILEO_CHAIN_ID, { staticNetwork: true });
    this.indexer = new Indexer(options.indexerUrl ?? GALILEO_INDEXER);
    this.wallet = options.privateKey ? new ethers.Wallet(options.privateKey, this.provider) : null;
    this.anchorAddress = options.anchorAddress ?? null;
  }

  get signer(): ethers.Wallet {
    if (!this.wallet) throw new Error("Missing OG_PRIVATE_KEY. See .env.example");
    return this.wallet;
  }

  private contract(runner: ethers.ContractRunner): ethers.Contract {
    if (!this.anchorAddress) throw new Error("Missing OG_ANCHOR_ADDRESS. Run: pnpm zerog deploy");
    return new ethers.Contract(this.anchorAddress, ANCHOR_ABI, runner);
  }

  async balance(): Promise<string> {
    return ethers.formatEther(await this.provider.getBalance(this.signer.address));
  }

  async upload(bytes: Uint8Array): Promise<{ rootHash: string; txHash: string }> {
    const data = new MemData(bytes);
    const [tree, treeError] = await data.merkleTree();
    if (treeError || !tree) throw treeError ?? new Error("No Merkle tree");
    const rootHash = tree.rootHash();
    if (!rootHash) throw new Error("No root hash");
    // The SDK's types use ethers' CommonJS build and ours use the ES build. It's the same version.
    const [tx, error] = await this.indexer.upload(data, this.rpcUrl, this.signer as never);
    if (error) throw error;
    return { rootHash, txHash: "txHash" in tx ? tx.txHash : "" };
  }

  /** Downloads with Merkle proof checks, so a storage node can't serve altered bytes. */
  async download(rootHash: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "proofbolt-"));
    try {
      const path = join(directory, "record");
      const error = await this.indexer.download(rootHash, path, true);
      if (error) throw error;
      return await readFile(path, "utf8");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async anchor(recordHash: string, storageRoot: string): Promise<string> {
    const anchor = this.contract(this.signer).getFunction("anchor");
    const tx = (await anchor(recordHash, storageRoot)) as ethers.ContractTransactionResponse;
    await tx.wait();
    return tx.hash;
  }

  async readAnchors(): Promise<AnchoredDecision[]> {
    const contract = this.contract(this.provider);
    const count = Number(await contract.getFunction("count")());
    const read = contract.getFunction("decisions");
    const result: AnchoredDecision[] = [];
    for (let index = 0; index < count; index++) {
      const { recordHash, storageRoot } = (await read(index)) as AnchoredDecision;
      result.push({ recordHash, storageRoot });
    }
    return result;
  }
}
