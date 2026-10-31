import { parseAttributeFilters } from './attribute-filters';

describe('parseAttributeFilters', () => {
  it('parses a JSON object into key/value entries', () => {
    expect(
      parseAttributeFilters('{"storage":"128GB","ram":"8GB","year":2021}'),
    ).toEqual([
      ['storage', '128GB'],
      ['ram', '8GB'],
      ['year', '2021'],
    ]);
  });

  it('ignores malformed JSON, non-objects and arrays', () => {
    expect(parseAttributeFilters('{oops')).toEqual([]);
    expect(parseAttributeFilters('"storage:128GB"')).toEqual([]);
    expect(parseAttributeFilters('[{"storage":"128GB"}]')).toEqual([]);
    expect(parseAttributeFilters('null')).toEqual([]);
  });

  it('ignores unsafe keys, blank and non-scalar values, and oversized input', () => {
    expect(
      parseAttributeFilters(
        '{"bad-key":"x","bad key":"x","":"x","ok":"v","num":42,"obj":{"a":1},"nul":null,"blank":"  "}',
      ),
    ).toEqual([
      ['ok', 'v'],
      ['num', '42'],
    ]);
  });

  it('drops the whole object past the entry cap', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 13 }, (_, i) => [`k${i}`, 'v']),
    );
    expect(parseAttributeFilters(JSON.stringify(wide))).toEqual([]);
  });

  it('returns empty for an absent param', () => {
    expect(parseAttributeFilters(undefined)).toEqual([]);
    expect(parseAttributeFilters('')).toEqual([]);
  });
});
