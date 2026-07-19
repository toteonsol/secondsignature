// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GuardianVault. A personal vault where an AI guardian co-signs every withdrawal.
/// @notice The owner proposes transactions; the guardian (an AI agent's address) approves
///         or objects with a reason. The guardian can never move funds alone, and can never
///         imprison the owner: any proposal can be force-executed by the owner alone after
///         OVERRIDE_DELAY. The guardian is a speed bump with judgment, not a custodian.
contract GuardianVault {
    enum Status { Pending, Executed, Rejected, Cancelled }

    struct Proposal {
        address to;
        uint256 value;
        bytes data;
        uint64 proposedAt;
        Status status;
    }

    /// @notice Delay after which the owner may execute without the guardian.
    uint64 public constant OVERRIDE_DELAY = 48 hours;

    address public immutable owner;
    address public guardian;

    Proposal[] public proposals;

    // Guardian rotation is timelocked so a compromised owner key can't
    // instantly swap in an attacker-controlled guardian.
    address public pendingGuardian;
    uint64 public guardianChangeReadyAt;

    event Deposited(address indexed from, uint256 amount);
    event Proposed(uint256 indexed id, address indexed to, uint256 value, bytes data);
    event Approved(uint256 indexed id, string reason);
    event Objected(uint256 indexed id, string reason);
    event Executed(uint256 indexed id, bool viaOverride);
    event Cancelled(uint256 indexed id);
    event GuardianChangeRequested(address indexed newGuardian, uint64 readyAt);
    event GuardianChanged(address indexed newGuardian);

    error NotOwner();
    error NotGuardian();
    error BadStatus();
    error TooEarly();
    error CallFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(address _owner, address _guardian) {
        owner = _owner;
        guardian = _guardian;
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    function proposalCount() external view returns (uint256) {
        return proposals.length;
    }

    /// @notice Owner proposes an outgoing transaction (transfer or arbitrary call).
    function propose(address to, uint256 value, bytes calldata data)
        external
        onlyOwner
        returns (uint256 id)
    {
        proposals.push(Proposal({
            to: to,
            value: value,
            data: data,
            proposedAt: uint64(block.timestamp),
            status: Status.Pending
        }));
        id = proposals.length - 1;
        emit Proposed(id, to, value, data);
    }

    /// @notice Guardian co-signs: approves and executes in one step, with its reasoning on-chain.
    function approve(uint256 id, string calldata reason) external onlyGuardian {
        Proposal storage p = proposals[id];
        if (p.status != Status.Pending) revert BadStatus();
        p.status = Status.Executed;
        emit Approved(id, reason);
        _execute(p);
        emit Executed(id, false);
    }

    /// @notice Guardian objects, recording its argument on-chain. The owner can still
    ///         cancel, or wait out OVERRIDE_DELAY and force it through.
    function object(uint256 id, string calldata reason) external onlyGuardian {
        Proposal storage p = proposals[id];
        if (p.status != Status.Pending) revert BadStatus();
        p.status = Status.Rejected;
        emit Objected(id, reason);
    }

    /// @notice Owner's escape hatch: execute without the guardian after the delay.
    ///         Works on Pending and Rejected proposals: an objection delays, never imprisons.
    function forceExecute(uint256 id) external onlyOwner {
        Proposal storage p = proposals[id];
        if (p.status != Status.Pending && p.status != Status.Rejected) revert BadStatus();
        if (block.timestamp < p.proposedAt + OVERRIDE_DELAY) revert TooEarly();
        p.status = Status.Executed;
        _execute(p);
        emit Executed(id, true);
    }

    function cancel(uint256 id) external onlyOwner {
        Proposal storage p = proposals[id];
        if (p.status != Status.Pending && p.status != Status.Rejected) revert BadStatus();
        p.status = Status.Cancelled;
        emit Cancelled(id);
    }

    /// @notice Rotating the guardian is itself timelocked, closing the "swap the
    ///         guardian, then drain" loophole for a stolen owner key.
    function requestGuardianChange(address newGuardian) external onlyOwner {
        pendingGuardian = newGuardian;
        guardianChangeReadyAt = uint64(block.timestamp) + OVERRIDE_DELAY;
        emit GuardianChangeRequested(newGuardian, guardianChangeReadyAt);
    }

    function confirmGuardianChange() external onlyOwner {
        if (pendingGuardian == address(0)) revert BadStatus();
        if (block.timestamp < guardianChangeReadyAt) revert TooEarly();
        guardian = pendingGuardian;
        pendingGuardian = address(0);
        emit GuardianChanged(guardian);
    }

    function _execute(Proposal storage p) private {
        (bool ok, ) = p.to.call{value: p.value}(p.data);
        if (!ok) revert CallFailed();
    }
}
