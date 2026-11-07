import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";
import hardhatTypechain from "@nomicfoundation/hardhat-typechain";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [
    hardhatEthers,
    hardhatTypechain,
    hardhatMocha,
    hardhatEthersChaiMatchers,
    hardhatNetworkHelpers,
    hardhatVerify,
    hardhatKeystore,
  ],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.SEPOLIA_RPC_URL ?? "http://127.0.0.1:8545",
      // La clé est lue en priorité dans la variable de processus
      // SEPOLIA_PRIVATE_KEY ; à défaut, dans le keystore chiffré alimenté par
      // `npx hardhat keystore set SEPOLIA_PRIVATE_KEY`. Le keystore évite de
      // faire transiter la clé par l'environnement et l'historique du shell.
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
  },
  // Publication du code source en regard des adresses déployées. Sourcify ne
  // demande aucune clé et reste donc toujours actif ; Etherscan n'est activé
  // que si ETHERSCAN_API_KEY est présent dans l'environnement du processus.
  verify: {
    sourcify: {
      enabled: true,
    },
    etherscan: process.env.ETHERSCAN_API_KEY
      ? { apiKey: process.env.ETHERSCAN_API_KEY }
      : { enabled: false },
  },
  test: {
    mocha: {
      timeout: 40_000,
    },
  },
});
