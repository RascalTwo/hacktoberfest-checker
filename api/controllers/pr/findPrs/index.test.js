const moment = require('moment');
const findPrs = require('./index');

const generatePRFactory = username => (
  number,
  labels,
  title,
  created_at,
  repo_name,
  state,
  merged,
  approved,
  topics
) => {
  const url = `https://github.com/${repo_name}/pull/${number}`;
  return {
    search: {
      issues: (_, cb) =>
        cb(null, {
          data: {
            items: [
              {
                number,
                title,
                created_at,
                state,
                labels: labels.map(label => ({ name: label })),
                html_url: url,
                pull_request: { html_url: url },
                user: {
                  login: username,
                  html_url: `https://github.com/${username}`
                }
              }
            ]
          }
        })
    },
    hasNextPage: () => false,
    pullRequests: {
      checkMerged: () =>
        Promise.resolve({
          meta: {
            status: merged ? '204 No Content' : '404 Not Found',
            'x-ratelimit-remaining': 9999
          }
        }),
      getReviews: () =>
        Promise.resolve({
          data: approved ? [{ state: 'APPROVED' }] : [],
          meta: { 'x-ratelimit-remaining': 9999 }
        })
    },
    repos: {
      getTopics: topics
        ? () =>
            Promise.resolve({
              data: { names: topics },
              meta: { 'x-ratelimit-remaining': 9999 }
            })
        : undefined
    }
  };
};

//console.log(require('util').inspect(event, null, null))

describe('PRs are constructed', () => {
  const generatePR = generatePRFactory('Username');
  test('shape is as expected', async () =>
    expect(
      await findPrs(
        generatePR(
          1,
          [],
          'Title',
          '2020-10-02T23:59:59Z',
          'owner/repo',
          'open',
          false,
          false
        ),
        'Username'
      )
    ).toEqual([
      {
        approved: false,
        created_at: 'October 2nd 2020',
        has_hacktoberfest_label: false,
        is_pending: true,
        merged: false,
        number: 1,
        open: true,
        repo_must_have_topic: false,
        repo_name: 'owner/repo',
        title: 'Title',
        url: 'https://github.com/owner/repo/pull/1',
        user: {
          login: 'Username',
          url: 'https://github.com/Username'
        }
      }
    ]));

  test('invalid tag filtered out (RV1)', async () => {
    expect(
      await findPrs(
        generatePR(
          1,
          ['invalid'],
          'Title',
          '2020-10-02T23:59:59Z',
          'owner/repo',
          'open',
          false,
          false
        ),
        'Username'
      )
    ).toEqual([]);
  });

  test('invalid spam filtered out', async () => {
    expect(
      await findPrs(
        generatePR(
          1,
          ['spam'],
          'Title',
          '2020-10-02T23:59:59Z',
          'owner/repo',
          'open',
          false,
          false
        ),
        'Username'
      )
    ).toEqual([]);
  });

  test('hacktoberfest-accepted label detected', async () => {
    expect(
      await findPrs(
        generatePR(
          1,
          ['hacktoberfest-accepted'],
          'Title',
          '2020-10-02T23:59:59Z',
          'owner/repo',
          'open',
          false,
          false
        ),
        'Username'
      )
    ).toEqual([expect.objectContaining({ has_hacktoberfest_label: true })]);

    expect(
      await findPrs(
        generatePR(
          1,
          ['hacktoberfest'],
          'Title',
          '2020-10-02T23:59:59Z',
          'owner/repo',
          'open',
          false,
          false
        ),
        'Username'
      )
    ).toEqual([expect.objectContaining({ has_hacktoberfest_label: false })]);
  });

  test('filter PRs without hacktoberfest-accepted label (V3)', async () => {
    expect(
      await findPrs(
        generatePR(
          1,
          ['hacktoberfest-accepted'],
          'Title',
          '2020-10-03T12:00:01Z',
          'owner/repo',
          'open',
          false,
          false,
          []
        ),
        'Username'
      )
    ).toEqual([expect.objectContaining({ has_hacktoberfest_label: true })]);
    expect(
      await findPrs(
        generatePR(
          1,
          [],
          'Title',
          '2020-10-03T12:00:01Z',
          'owner/repo',
          'open',
          false,
          false,
          []
        ),
        'Username'
      )
    ).toEqual([]);
  });

  test('is_pending', async () => {
    expect(
      await findPrs(
        generatePR(
          1,
          [],
          'Title',
          // Not 100% accurate/testing, would need to mock properly
          moment
            .utc('2020-10-03T00:00:00Z')
            .subtract(14, 'days')
            .format(),
          'owner/repo',
          'open',
          false,
          false
        ),
        'Username'
      )
    ).toEqual([expect.objectContaining({ is_pending: false })]);
  });

  test('Initial PRs still follow V1 rules', async () => {
    const withoutPRs = await findPrs(
      generatePR(
        1,
        [],
        'Title',
        '2020-10-03T00:00:00Z',
        'owner/repo',
        'open',
        false,
        false
      ),
      'Username'
    );
    expect(withoutPRs).toEqual([
      expect.objectContaining({ repo_must_have_topic: false })
    ]);
    expect(withoutPRs[0]).not.toHaveProperty('repo_has_hacktoberfest_topic');
  });

  test('filter out PRs not merged/approved with hacktoberfest repo topic (RV3)', async () => {
    // Approved and under new rules, appear
    expect(
      await findPrs(
        generatePR(
          1,
          [],
          'Title',
          '2020-10-03T12:00:01Z',
          'owner/repo',
          'open',
          false,
          true,
          ['hacktoberfest']
        ),
        'Username'
      )
    ).toEqual([
      expect.objectContaining({
        repo_must_have_topic: true,
        repo_has_hacktoberfest_topic: true
      })
    ]);
    // Merged and under new rules, appear
    expect(
      await findPrs(
        generatePR(
          1,
          [],
          'Title',
          '2020-10-03T12:00:01Z',
          'owner/repo',
          'open',
          true,
          false,
          ['hacktoberfest']
        ),
        'Username'
      )
    ).toEqual([
      expect.objectContaining({
        repo_must_have_topic: true,
        repo_has_hacktoberfest_topic: true
      })
    ]);
    // Neither merged or approved under new rules, don't appear
    expect(
      await findPrs(
        generatePR(
          1,
          [],
          'Title',
          '2020-10-03T12:00:01Z',
          'owner/repo',
          'open',
          false,
          false,
          ['hacktoberfest']
        ),
        'Username'
      )
    ).toEqual([]);
  });

  test('merged', async () => {
    // Under new rules, don't appear if not merged
    expect(
      await findPrs(
        generatePR(
          1,
          [],
          'Title',
          '2020-10-03T12:00:01Z',
          'owner/repo',
          'open',
          false,
          false,
          ['hacktoberfest']
        ),
        'Username'
      )
    ).toEqual([]);
    // Under old rules, appear even if not merged
    expect(
      await findPrs(
        generatePR(
          1,
          [],
          'Title',
          '2020-10-03T12:00:00Z',
          'owner/repo',
          'open',
          false,
          false,
          ['hacktoberfest']
        ),
        'Username'
      )
    ).toEqual([expect.objectContaining({ merged: false })]);
    // Under new rules, appear if merged
    expect(
      await findPrs(
        generatePR(
          1,
          [],
          'Title',
          '2020-10-03T12:00:01Z',
          'owner/repo',
          'open',
          true,
          false,
          ['hacktoberfest']
        ),
        'Username'
      )
    ).toEqual([
      expect.objectContaining({
        merged: true
      })
    ]);
  });

  test('approved', async () => {
    // Under new rules, don't appear if not approved
    expect(
      await findPrs(
        generatePR(
          1,
          [],
          'Title',
          '2020-10-03T12:00:01Z',
          'owner/repo',
          'open',
          false,
          false,
          ['hacktoberfest']
        ),
        'Username'
      )
    ).toEqual([]);
    // Under old rules, appear even if not approved
    expect(
      await findPrs(
        generatePR(
          1,
          [],
          'Title',
          '2020-10-03T12:00:00Z',
          'owner/repo',
          'open',
          false,
          false,
          ['hacktoberfest']
        ),
        'Username'
      )
    ).toEqual([expect.objectContaining({ approved: false })]);
    // Under new rules, appear if approved
    expect(
      await findPrs(
        generatePR(
          1,
          [],
          'Title',
          '2020-10-03T12:00:01Z',
          'owner/repo',
          'open',
          false,
          true,
          ['hacktoberfest']
        ),
        'Username'
      )
    ).toEqual([
      expect.objectContaining({
        approved: true
      })
    ]);
  });
});
