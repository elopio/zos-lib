pragma solidity ^0.4.21;

/**
 * @title Proxy
 * @dev Gives the possibility to delegate any call to a foreign implementation.
 */
contract Proxy {
  /**
   * @return address of the implementation to which all calls will be delegated.
   */
  function _implementation() internal view returns (address);

  /**
   * @dev Performs a delegatecall to the address returned by _implementation().
   * @dev This is a low level function that doesn't return to its internal caller.
   * @dev It will return to the external caller whatever the implementation returns.
   */
  function _delegate() internal {
    address _impl = _implementation();
    require(_impl != address(0));

    assembly {
      let ptr := mload(0x40)
      calldatacopy(ptr, 0, calldatasize)
      let result := delegatecall(gas, _impl, ptr, calldatasize, 0, 0)
      let size := returndatasize
      returndatacopy(ptr, 0, size)

      switch result
      case 0 { revert(ptr, size) }
      default { return(ptr, size) }
    }
  }

  /**
   * @dev Delegates all incoming calls to the implementation.
   */
  function () payable public {
    _delegate();
  }
}
