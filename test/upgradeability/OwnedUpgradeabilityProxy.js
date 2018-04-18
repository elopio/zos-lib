'use strict'

const encodeCall = require('../helpers/encodeCall')
const assertRevert = require('../helpers/assertRevert')
const MigratableMockV1 = artifacts.require('MigratableMockV1')
const MigratableMockV2 = artifacts.require('MigratableMockV2')
const MigratableMockV3 = artifacts.require('MigratableMockV3')
const InitializableMock = artifacts.require('InitializableMock')
const OwnedUpgradeabilityProxy = artifacts.require('OwnedUpgradeabilityProxy')
const UpgradeabilityProxyFactory = artifacts.require('UpgradeabilityProxyFactory')

contract('OwnedUpgradeabilityProxy', ([_, owner, anotherAccount, implementation_v0, implementation_v1]) => {
  beforeEach(async function () {
    this.factory = await UpgradeabilityProxyFactory.new()
    const { logs } = await this.factory.createProxy(owner, implementation_v0)
    this.proxyAddress = logs.find(l => l.event === 'ProxyCreated').args.proxy
    this.proxy = await OwnedUpgradeabilityProxy.at(this.proxyAddress)
  })

  describe('owner', function () {
    it('transfers the ownership to the requested owner', async function () {
      const proxyOwner = await this.proxy.proxyOwner()

      assert.equal(proxyOwner, owner)
    })
  })

  describe('implementation', function () {
    it('returns the current implementation address', async function () {
      const implementation = await this.proxy.implementation()

      assert.equal(implementation, implementation_v0)
    })
  })

  describe('fallback', function () {
    beforeEach(async function () {
      this.behavior = await InitializableMock.new()
      this.proxy = await OwnedUpgradeabilityProxy.new()
      this.mock = InitializableMock.at(this.proxy.address)
    })

    describe('when there is an implementation set', function () {
      it('calls the implementation', async function () {
        await this.proxy.upgradeTo(this.behavior.address)

        await this.mock.initialize(42)
        const value = await this.mock.x()

        assert.equal(value, 42)
      })
    })

    describe('when there is no implementation set', function () {
      it('reverts', async function () {
        await assertRevert(this.mock.initialize(42))
      })
    })
  })

  describe('upgradeTo', function () {
    describe('when the sender is the owner', function () {
      const from = owner

      describe('when the given implementation is different from the current one', function () {
        const newImplementation = implementation_v1

        it('upgrades to the requested implementation', async function () {
          await this.proxy.upgradeTo(newImplementation, { from })

          const implementation = await this.proxy.implementation()
          assert.equal(implementation, implementation_v1)
        })

        it('emits an event', async function () {
          const { logs } = await this.proxy.upgradeTo(newImplementation, { from })

          assert.equal(logs.length, 1)
          assert.equal(logs[0].event, 'Upgraded')
          assert.equal(logs[0].args.implementation, implementation_v1)
        })
      })

      describe('when the given implementation is the same as the current one', function () {
        const newImplementation = implementation_v0

        it('reverts', async function () {
          await assertRevert(this.proxy.upgradeTo(newImplementation, { from }))
        })
      })

      describe('when the given implementation is the zero address', function () {
        const newImplementation = 0x0

        it('reverts', async function () {
          await assertRevert(this.proxy.upgradeTo(newImplementation, { from }))
        })
      })
    })

    describe('when the sender is not the owner', function () {
      const from = anotherAccount

      it('reverts', async function () {
        await assertRevert(this.proxy.upgradeTo(implementation_v1, { from }))
      })
    })
  })

  describe('upgradeToAndCall', function () {
    describe('without migrations', function () {
      beforeEach(async function () {
        this.behavior = await InitializableMock.new()
      })

      describe('when the call does not fail', function () {
        const initializeData = encodeCall('initialize', ['uint256'], [42])

        describe('when the sender is the owner', function () {
          const from = owner
          const value = 1e5

          beforeEach(async function () {
            this.logs = (await this.proxy.upgradeToAndCall(this.behavior.address, initializeData, { from, value })).logs
          })

          it('upgrades to the requested implementation', async function () {
            const implementation = await this.proxy.implementation()
            assert.equal(implementation, this.behavior.address)
          })

          it('emits an event', async function () {
            assert.equal(this.logs.length, 1)
            assert.equal(this.logs[0].event, 'Upgraded')
            assert.equal(this.logs[0].args.implementation, this.behavior.address)
          })

          it('calls the "initialize" function', async function() {
            const initializable = InitializableMock.at(this.proxyAddress)
            const x = await initializable.x()
            assert.equal(x, 42)
          })

          it('sends given value to the proxy', async function() {
            const balance = await web3.eth.getBalance(this.proxyAddress)
            assert(balance.eq(value))
          })

          it('uses the storage of the proxy', async function () {
            // fetch the x value of Initializable at position 0 of the storage
            const storedValue = await web3.eth.getStorageAt(this.proxyAddress, 1);
            assert.equal(storedValue, 42);
          })
        })

        describe('when the sender is not the owner', function () {
          const from = anotherAccount

          it('reverts', async function () {
            await assertRevert(this.proxy.upgradeToAndCall(this.behavior.address, initializeData, { from }))
          })
        })
      })

      describe('when the call does fail', function () {
        const initializeData = encodeCall('fail')

        it('reverts', async function () {
          await assertRevert(this.proxy.upgradeToAndCall(this.behavior.address, initializeData, { from: owner }))
        })
      })
    })

    describe('with migrations', function () {
      describe('when the sender is the owner', function () {
        const from = owner
        const value = 1e5

        describe('when upgrading to V1', function () {
          const v1MigrationData = encodeCall('initialize', ['uint256'], [42])

          beforeEach(async function () {
            this.behavior_v1 = await MigratableMockV1.new()
            this.balancePrevious_v1 = await web3.eth.getBalance(this.proxyAddress)
            this.logs = (await this.proxy.upgradeToAndCall(this.behavior_v1.address, v1MigrationData, { from, value })).logs
          })

          it('upgrades to the requested version and emits an event', async function () {
            const implementation = await this.proxy.implementation()
            assert.equal(implementation, this.behavior_v1.address)
            assert.equal(this.logs.length, 1)
            assert.equal(this.logs[0].event, 'Upgraded')
            assert.equal(this.logs[0].args.implementation, this.behavior_v1.address)
          })

          it('calls the "initialize" function and sends given value to the proxy', async function() {
            const migratable = MigratableMockV1.at(this.proxyAddress)

            const x = await migratable.x()
            assert.equal(x, 42)

            const balance = await web3.eth.getBalance(this.proxyAddress)
            assert(balance.eq(this.balancePrevious_v1.plus(value)))
          })

          describe('when upgrading to V2', function () {
            const v2MigrationData = encodeCall('migrate', ['uint256', 'uint256'], [10, 42])

            beforeEach(async function () {
              this.behavior_v2 = await MigratableMockV2.new()
              this.balancePrevious_v2 = await web3.eth.getBalance(this.proxyAddress)
              this.logs = (await this.proxy.upgradeToAndCall(this.behavior_v2.address, v2MigrationData, { from, value })).logs
            })

            it('upgrades to the requested version and emits an event', async function () {
              const implementation = await this.proxy.implementation()
              assert.equal(implementation, this.behavior_v2.address)
              assert.equal(this.logs.length, 1)
              assert.equal(this.logs[0].event, 'Upgraded')
              assert.equal(this.logs[0].args.implementation, this.behavior_v2.address)
            })

            it('calls the "migrate" function and sends given value to the proxy', async function() {
              const migratable = MigratableMockV2.at(this.proxyAddress)

              const x = await migratable.x()
              assert.equal(x, 10)

              const y = await migratable.y()
              assert.equal(y, 42)

              const balance = await web3.eth.getBalance(this.proxyAddress)
              assert(balance.eq(this.balancePrevious_v2.plus(value)))
            })

            describe('when upgrading to V3', function () {
              const v3MigrationData = encodeCall('migrate')

              beforeEach(async function () {
                this.behavior_v3 = await MigratableMockV3.new()
                this.balancePrevious_v3 = await web3.eth.getBalance(this.proxyAddress)
                this.logs = (await this.proxy.upgradeToAndCall(this.behavior_v3.address, v3MigrationData, { from, value })).logs
              })

              it('upgrades to the requested version and emits an event', async function () {
                const implementation = await this.proxy.implementation()
                assert.equal(implementation, this.behavior_v3.address)
                assert.equal(this.logs.length, 1)
                assert.equal(this.logs[0].event, 'Upgraded')
                assert.equal(this.logs[0].args.implementation, this.behavior_v3.address)
              })

              it('calls the "migrate" function and sends given value to the proxy', async function() {
                const migratable = MigratableMockV3.at(this.proxyAddress)

                const x = await migratable.x()
                assert.equal(x, 42)

                const y = await migratable.y()
                assert.equal(y, 10)

                const balance = await web3.eth.getBalance(this.proxyAddress)
                assert(balance.eq(this.balancePrevious_v3.plus(value)))
              })
            })
          })
        })
      })

      describe('when the sender is not the owner', function () {
        const from = anotherAccount

        it('reverts', async function () {
          const behavior_v1 = await MigratableMockV1.new()
          const v1MigrationData = encodeCall('initialize', ['uint256'], [42])
          await assertRevert(this.proxy.upgradeToAndCall(behavior_v1.address, v1MigrationData, { from }))
        })
      })
    })
  })

  describe('transferOwnership', function () {
    describe('when the new proposed owner is not the zero address', function () {
      const newOwner = anotherAccount

      describe('when the sender is the owner', function () {
        const from = owner

        it('transfers the ownership', async function () {
          await this.proxy.transferProxyOwnership(newOwner, { from })

          const proxyOwner = await this.proxy.proxyOwner()
          assert.equal(proxyOwner, anotherAccount)
        })

        it('emits an event', async function () {
          const { logs } = await this.proxy.transferProxyOwnership(newOwner, { from })

          assert.equal(logs.length, 1)
          assert.equal(logs[0].event, 'ProxyOwnershipTransferred')
          assert.equal(logs[0].args.previousOwner, owner)
          assert.equal(logs[0].args.newOwner, newOwner)
        })
      })

      describe('when the sender is not the owner', function () {
        const from = anotherAccount

        it('reverts', async function () {
          await assertRevert(this.proxy.transferProxyOwnership(newOwner, { from }))
        })
      })
    })

    describe('when the new proposed owner is the zero address', function () {
      const newOwner = 0x0

      it('reverts', async function () {
        await assertRevert(this.proxy.transferProxyOwnership(newOwner, { from: owner }))
      })
    })
  })

  describe('storage', function () {
    it('should store the implementation address in specified location', async function () {
      const position = web3.sha3("org.zeppelinos.proxy.implementation");
      const implementation = await web3.eth.getStorageAt(this.proxyAddress, position);

      assert.equal(implementation, implementation_v0);
    })

    it('should store the owner proxy in specified location', async function () {
      const position = web3.sha3("org.zeppelinos.proxy.owner");
      const proxyOwner = await web3.eth.getStorageAt(this.proxyAddress, position);

      assert.equal(proxyOwner, owner);
    })
  })
})
