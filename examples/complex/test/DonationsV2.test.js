const DonationsV2 = artifacts.require('DonationsV2');
const MintableERC721Token = artifacts.require('MintableERC721Token');

const shouldBehaveLikeDonationsWithTokens = require('./DonationsWithTokens.behavior.js');

contract('DonationsV2', (accounts) => {

  const owner = accounts[0];
  const donor1 = accounts[1];
  const tokenName = 'DonationToken';
  const tokenSymbol = 'DON';

  beforeEach(async function() {
    this.donations = await DonationsV2.new();
    await this.donations.initialize(owner);
    this.token = await MintableERC721Token.new();
    await this.token.initialize(this.donations.address, tokenName, tokenSymbol);
    await this.donations.setToken(this.token.address, {from: owner});
  });

  shouldBehaveLikeDonationsWithTokens(accounts);
});
