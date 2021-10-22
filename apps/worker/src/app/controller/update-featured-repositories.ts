import { BigQuery } from '@google-cloud/bigquery';
import { Firestore } from '@google-cloud/firestore';
import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { environment } from '../../environments/environment';

type RepositoryUsageRow = {
  repository: string;
  days: number;
  stars: number;
  contributors: number;
};

async function queryRepositoryUsage({ minStars = 1000, limit = 50 }: { minStars?: number; limit?: number }) {
  const bq = new BigQuery();
  const query = `
SELECT
  repository,
  COUNT(DISTINCT _date) AS days,
  MAX(stargazers) AS stars,
  MAX(contributors) AS contributors,
FROM (
  SELECT
    jsonPayload.repository AS repository,
    DATE(TIMESTAMP_MILLIS(CAST(jsonPayload.timestamp AS INT64))) AS _date,
    jsonPayload.stargazers AS stargazers,
    jsonPayload.contributors AS contributors
  FROM
    \`contributors-img.repository_usage.repository_usage_*\`
  WHERE
    labels.environment = @environment
    AND _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 7 day))
    AND FORMAT_DATE('%Y%m%d', CURRENT_DATE()))
GROUP BY
  repository
HAVING
  days >= 5
  AND stars > @minStars
ORDER BY
  stars DESC,
  contributors DESC
LIMIT
  @limit`.trim();
  const [rows] = await bq.query(
    {
      query,
      params: {
        environment: environment.environment,
        minStars,
        limit,
      },
    },
    {},
  );

  return rows as RepositoryUsageRow[];
}

async function saveFeaturedRepositories(featuredRepositories: RepositoryUsageRow[]) {
  const firestore = new Firestore();
  try {
    await firestore
      .collection(`${environment.environment}`)
      .doc('featured_repositories')
      .set({ items: featuredRepositories });
  } catch (error) {
    console.error(error);
  }
}

@injectable()
export class UpdateFeaturedRepositoriesController {
  async onRequest(req: Request, res: Response) {
    try {
      const rows = await queryRepositoryUsage({});
      rows.forEach((row) => console.log(JSON.stringify(row)));
      await saveFeaturedRepositories(rows);
      res.status(200).send('OK');
    } catch (error) {
      res.status(500).send(error);
    }
  }
}
