# Repository Traffic Character Card Design

## Goal

Add a GitHub Animal-inspired visitor card to the profile README that shows long-term repository traffic while keeping the raw traffic history private.

## Public Output

The public `hyunolike/hyunolike` profile repository will contain only generated and non-sensitive assets:

- `repo-traffic.svg`: generated visitor card displayed in `README.md`
- `scripts/generate-repo-traffic.mjs`: generator script
- `.github/workflows/update-profile-assets.yml`: scheduled workflow
- `README.md`: embeds the generated SVG

The generated SVG may show aggregate values such as total views, unique visitors, top repository, 14-day views, and clone counts. These displayed values are intentionally public.

## Private Data

Raw historical traffic snapshots will not be committed to the profile repository.

The workflow will store and update private history in a separate private repository:

- `hyunolike/profile-private-data`
- `traffic-history.json`

This file stores date-level and repository-level snapshots needed to calculate long-term totals beyond GitHub's 14-day traffic API window.

## Data Flow

1. GitHub Actions runs daily.
2. The workflow lists target repositories for `hyunolike`.
3. For each repository, it calls GitHub Traffic API endpoints:
   - `/repos/{owner}/{repo}/traffic/views`
   - `/repos/{owner}/{repo}/traffic/clones`
4. The workflow checks out or fetches the private `profile-private-data` repository.
5. The script merges today's API snapshot into private `traffic-history.json`.
6. The script calculates public aggregate metrics.
7. The script generates `repo-traffic.svg`.
8. The workflow commits `repo-traffic.svg` to the public profile repository.
9. The workflow commits updated `traffic-history.json` only to the private repository.

## Card Content

The first version will show:

- title: `Repository Visitors`
- small animated SVG character
- visitor level derived from total unique visitors
- total views
- total unique visitors
- total clones
- top repository by recent views
- top three repositories by recent views
- last updated date in Asia/Seoul

Example layout:

```text
Repository Visitors
Lv. 655 Visitor

Total Views         12,430
Unique Visitors      2,180
Total Clones           742
Top Repo        moyeorak-web

Most Viewed Repositories - Last 14 Days
1. moyeorak-web        320
2. spring-template      91
3. blog-source          44
```

## Visual Style

The SVG should match the existing README style:

- dark GitHub-like card with light-mode media query support
- compact enough to sit near the existing GitHub Animal and stats sections
- pixel-style character made directly in SVG
- subtle CSS or SVG animation only, because GitHub README does not allow JavaScript in SVG
- no external runtime dependency for rendering the card

## Privacy And Security

Secrets must remain in GitHub Actions secrets:

- public profile repository write token, if the default token is insufficient
- private repository read/write token

The workflow must not print token values or raw traffic history in logs.

## Constraints

GitHub's repository traffic API only provides recent traffic data, roughly the last 14 days. Long-term totals start from the first successful daily collection run. Historical traffic from before that cannot be recovered through the API.

## Success Criteria

- `README.md` displays `repo-traffic.svg`.
- `repo-traffic.svg` is generated from real GitHub Traffic API data when Actions runs.
- Raw `traffic-history.json` is never committed to the public profile repository.
- The private history file is updated daily.
- The card still renders if some repositories return missing or forbidden traffic data.
