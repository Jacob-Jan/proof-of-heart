import { routes } from './app.routes';

describe('hardcoded charity slug route', () => {
  it('maps bitcoin-voor-serious-request to its permanent Nostr identity', () => {
    const route = routes.find(candidate => candidate.path === 'charity/bitcoin-voor-serious-request');

    expect(route).toBeDefined();
    expect(route?.data?.['charityId']).toBe(
      'npub17m4ytjcufua637q43386d8zmzhlgemh36vg56ga5fwy3qxavfm4sfllkff'
    );
  });
});