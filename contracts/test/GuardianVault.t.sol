// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GuardianVault} from "../src/GuardianVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

contract GuardianVaultTest is Test {
    VaultFactory factory;
    GuardianVault vault;
    address owner = makeAddr("owner");
    address guardian = makeAddr("guardian");
    address stranger = makeAddr("stranger");
    address payable dest = payable(makeAddr("dest"));

    function setUp() public {
        factory = new VaultFactory(guardian);
        vm.prank(owner);
        vault = GuardianVault(payable(factory.createVault(address(0))));
        vm.deal(address(vault), 10 ether);
    }

    function _propose(uint256 amount) internal returns (uint256 id) {
        vm.prank(owner);
        id = vault.propose(dest, amount, "");
    }

    function test_factoryWiring() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.guardian(), guardian);
        assertEq(factory.vaultCountOf(owner), 1);
    }

    function test_approveExecutes() public {
        uint256 id = _propose(1 ether);
        vm.prank(guardian);
        vault.approve(id, "routine transfer, known pattern");
        assertEq(dest.balance, 1 ether);
    }

    function test_guardianAloneCannotMoveFunds() public {
        // No proposal path exists for the guardian at all.
        vm.prank(guardian);
        vm.expectRevert(GuardianVault.NotOwner.selector);
        vault.propose(dest, 1 ether, "");
    }

    function test_strangerCannotProposeOrApprove() public {
        vm.prank(stranger);
        vm.expectRevert(GuardianVault.NotOwner.selector);
        vault.propose(dest, 1 ether, "");
        uint256 id = _propose(1 ether);
        vm.prank(stranger);
        vm.expectRevert(GuardianVault.NotGuardian.selector);
        vault.approve(id, "x");
    }

    function test_objectionBlocksButOverrideWins() public {
        uint256 id = _propose(9 ether);
        vm.prank(guardian);
        vault.object(id, "sending 90% of balance to a fresh address");

        vm.prank(owner);
        vm.expectRevert(GuardianVault.TooEarly.selector);
        vault.forceExecute(id);

        vm.warp(block.timestamp + 48 hours);
        vm.prank(owner);
        vault.forceExecute(id);
        assertEq(dest.balance, 9 ether);
    }

    function test_cannotDoubleExecute() public {
        uint256 id = _propose(1 ether);
        vm.prank(guardian);
        vault.approve(id, "ok");
        vm.prank(guardian);
        vm.expectRevert(GuardianVault.BadStatus.selector);
        vault.approve(id, "ok again");
        vm.warp(block.timestamp + 48 hours);
        vm.prank(owner);
        vm.expectRevert(GuardianVault.BadStatus.selector);
        vault.forceExecute(id);
    }

    function test_cancel() public {
        uint256 id = _propose(1 ether);
        vm.prank(owner);
        vault.cancel(id);
        vm.prank(guardian);
        vm.expectRevert(GuardianVault.BadStatus.selector);
        vault.approve(id, "x");
    }

    function test_guardianChangeIsTimelocked() public {
        vm.prank(owner);
        vault.requestGuardianChange(stranger);
        vm.prank(owner);
        vm.expectRevert(GuardianVault.TooEarly.selector);
        vault.confirmGuardianChange();
        vm.warp(block.timestamp + 48 hours);
        vm.prank(owner);
        vault.confirmGuardianChange();
        assertEq(vault.guardian(), stranger);
    }

    function test_arbitraryCallExecution() public {
        // approve() forwards calldata, so vaults can interact with contracts too.
        uint256 id;
        vm.prank(owner);
        id = vault.propose(address(factory), 0, abi.encodeCall(VaultFactory.createVault, (guardian)));
        vm.prank(guardian);
        vault.approve(id, "creating a sub-vault");
        assertEq(factory.vaultCountOf(address(vault)), 1);
    }
}
