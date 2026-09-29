import { sanitizeDescriptionHtml } from './safe-description-html';

describe('sanitizeDescriptionHtml', () => {
  it('preserves soft line breaks between links when other text is formatted', () => {
    const html = '<p><strong>Support our work</strong></p><p><a href="https://one.example">One</a><br><a href="https://two.example">Two</a><br><a href="https://three.example">Three</a></p>';

    const sanitized = sanitizeDescriptionHtml(html);

    expect(sanitized).toContain('<strong>Support our work</strong>');
    expect((sanitized.match(/<br>/g) || []).length).toBe(2);
    expect((sanitized.match(/<a /g) || []).length).toBe(3);
  });

  it('preserves blank paragraph breaks between links when other text is formatted', () => {
    const html = '<p><strong>Support our work</strong></p><p><br></p><p><a href="https://one.example">One</a></p><p><a href="https://two.example">Two</a></p><p><a href="https://three.example">Three</a></p>';

    expect(sanitizeDescriptionHtml(html)).toContain('<p><br></p>');
  });
});
