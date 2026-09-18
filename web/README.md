# web — the Project Hestia dashboard

A Next.js (App Router) editorial dashboard: reviewers approve or decline
collected articles, and content creators read the approved week.

```bash
nvm use            # Node 22+; supabase-js requires it
npm install
cp .env.example .env.local     # then fill it in
npm run dev
```

| Command | |
|---|---|
| `npm run dev` | Development server on :3000 |
| `npm run build` | Production build |
| `npm start` | Serve the build (reads `PORT`, binds 0.0.0.0) |
| `npm test` | vitest |
| `npm run typecheck` | tsc --noEmit |
| `npm run lint` | eslint |

Setup, architecture and the editorial rules live in the [repository
README](../README.md). Deployment is [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md)
— the dashboard runs on Render, defined by `render.yaml` at the repository
root; the Python worker runs on GitHub Actions.

Row Level Security in Supabase is the security boundary, not this app. Hiding a
button is not access control, and every page guard here is the second of three
layers.
