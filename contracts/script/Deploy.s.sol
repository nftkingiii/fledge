// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Nkwa} from "../src/Nkwa.sol";

/// Deploys Nkwa with the backend's operator address.
/// forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $DEPLOYER_KEY --broadcast
contract Deploy is Script {
    function run() external {
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        vm.startBroadcast();
        Nkwa nkwa = new Nkwa(operator);
        vm.stopBroadcast();
        console.log("Nkwa", address(nkwa));
    }
}
