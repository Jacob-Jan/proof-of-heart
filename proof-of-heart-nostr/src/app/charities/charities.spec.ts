import { selectCharityCardSummary } from './charities';

describe('selectCharityCardSummary', () => {
  it('uses the Nostr bio before the app short description', () => {
    expect(selectCharityCardSummary({
      about: 'Nostr bio',
      charity: {
        shortDescription: 'App short summary',
        description: '<p>Long rich description</p>'
      }
    })).toBe('Nostr bio');
  });

  it('falls back to the app short description without leaking long rich HTML', () => {
    expect(selectCharityCardSummary({
      about: '',
      charity: {
        shortDescription: 'App short summary',
        description: '<p>Long <strong>rich</strong> description</p>'
      }
    })).toBe('App short summary');
  });

  it('shows a neutral placeholder instead of the long rich description when no short summary is available', () => {
    expect(selectCharityCardSummary({
      about: '',
      charity: {
        description: '<p>Long <strong>rich</strong> description</p>'
      }
    })).toBe('Short summary not available yet.');
  });
});
