import { likeTerm } from './like-term';

describe('likeTerm', () => {
  it('wraps plain text in wildcards', () => {
    expect(likeTerm('honda')).toBe('%honda%');
  });

  it('escapes the caller’s own LIKE wildcards and backslashes', () => {
    expect(likeTerm('100%')).toBe('%100\\%%');
    expect(likeTerm('a_b')).toBe('%a\\_b%');
    expect(likeTerm('a\\b')).toBe('%a\\\\b%');
  });
});
