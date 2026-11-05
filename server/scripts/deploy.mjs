// Deploys Nkwa to Base Sepolia from the Foundry artifact, gives the operator and demo
// roles gas, and writes NKWA_ADDRESS / DEPLOY_BLOCK into server/.env.
// node --env-file=.env scripts/deploy.mjs
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const artifact = JSON.parse(fs.readFileSync(new URL("../../contracts/out-deploy/Nkwa.json", import.meta.url)));
const transport = http(process.env.RPC_URL);
const pub = createPublicClient({ chain: baseSepolia, transport });
const deployer = privateKeyToAccount(process.env.DEPLOYER_KEY);
const wallet = createWalletClient({ account: deployer, chain: baseSepolia, transport });
const operator = privateKeyToAccount(process.env.OPERATOR_KEY);
const roles = process.env.DEMO_KEYS.split(",").map((k) => privateKeyToAccount(k.trim()));

let address = process.env.NKWA_ADDRESS;
let block = process.env.DEPLOY_BLOCK;
if (!address) {
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [operator.address] });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  address = receipt.contractAddress;
  block = String(receipt.blockNumber);
  console.log("deployed", address, "block", block, "tx", hash);
  const env = fs.readFileSync(".env", "utf8")
    .replace(/^NKWA_ADDRESS=.*$/m, `NKWA_ADDRESS=${address}`)
    .replace(/^DEPLOY_BLOCK=.*$/m, "") + `DEPLOY_BLOCK=${block}\n`;
  fs.writeFileSync(".env", env.replace(/\n{3,}/g, "\n\n"));
}

const onchainOperator = await pub.readContract({ address, abi: artifact.abi, functionName: "operator" });
console.log("operator on chain matches:", onchainOperator === operator.address);

// Gas for the operator and each demo role.
const targets = [[operator.address, "0.012"], ...roles.map((r) => [r.address, "0.006"])];
for (const [to, amount] of targets) {
  const bal = await pub.getBalance({ address: to });
  if (bal >= parseEther(amount) / 2n) continue;
  const hash = await wallet.sendTransaction({ to, value: parseEther(amount) });
  await pub.waitForTransactionReceipt({ hash });
  console.log("funded", to, amount);
}
console.log("deployer left", formatEther(await pub.getBalance({ address: deployer.address })), "ETH");
