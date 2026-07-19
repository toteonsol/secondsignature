// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianVault} from "./GuardianVault.sol";

/// @title VaultFactory. Anyone creates their own self-custodial GuardianVault.
/// @notice One hosted guardian agent can co-sign for every vault; funds only ever
///         live in each user's own contract.
contract VaultFactory {
    /// @notice The default guardian agent's signing address (the hosted service).
    address public immutable defaultGuardian;

    mapping(address => address[]) public vaultsOf;
    address[] public allVaults;

    event VaultCreated(address indexed owner, address indexed vault, address indexed guardian);

    constructor(address _defaultGuardian) {
        defaultGuardian = _defaultGuardian;
    }

    /// @notice Create a vault guarded by the default agent, or bring your own guardian.
    function createVault(address guardian) external returns (address vault) {
        address g = guardian == address(0) ? defaultGuardian : guardian;
        vault = address(new GuardianVault(msg.sender, g));
        vaultsOf[msg.sender].push(vault);
        allVaults.push(vault);
        emit VaultCreated(msg.sender, vault, g);
    }

    function vaultCountOf(address user) external view returns (uint256) {
        return vaultsOf[user].length;
    }

    function totalVaults() external view returns (uint256) {
        return allVaults.length;
    }
}
