// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Public record of every unlock decision. Each entry fixes a decision's hash and where
/// its full record sits on 0G Storage, so the gateway can't quietly rewrite or drop one later.
contract DecisionAnchor {
    struct Decision {
        bytes32 recordHash;
        bytes32 storageRoot;
    }

    error NotGateway();

    event DecisionAnchored(uint256 indexed index, bytes32 recordHash, bytes32 storageRoot);

    address public immutable gateway;
    Decision[] public decisions;

    constructor() {
        gateway = msg.sender;
    }

    function anchor(bytes32 recordHash, bytes32 storageRoot) external {
        if (msg.sender != gateway) revert NotGateway();
        decisions.push(Decision(recordHash, storageRoot));
        emit DecisionAnchored(decisions.length - 1, recordHash, storageRoot);
    }

    function count() external view returns (uint256) {
        return decisions.length;
    }
}
