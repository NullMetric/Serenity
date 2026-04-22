# Serenity

Serenity is a launch-ready mental wellness MVP built from your prototype. It includes:

- A calming single-page experience for mood tracking, journaling, guided exercises, and AI chat
- A Node.js backend with persistent JSON storage
- Gemini-powered support chat with mental-health-only guardrails
- Crisis-aware fallback messaging and clear emergency guidance

## Quick Start

1. Copy `.env.example` to `.env`
2. Add your `GEMINI_API_KEY`
3. Run `npm start`
4. Open `http://localhost:3000`

## Scripts

- `npm start` starts the production server
- `npm run dev` starts the watcher for local development

## Environment Variables

- `PORT` server port, defaults to `3000`
- `GEMINI_API_KEY` required for live Gemini chat responses
- `SITE_NAME` optional display name in the API
- `SUPPORT_EMAIL` optional footer/support contact

## Features

- Daily mood check-ins with streaks and 7-day trends
- Journal saving and lightweight reflection analysis
- Gemini-based support chat restricted to mental wellness, self-reflection, coping skills, and app-related guidance
- Guided breathing and grounding exercises
- Crisis-support banner with emergency escalation guidance

## Deployment

This app is designed to deploy easily on platforms like Render, Railway, Fly.io, or a basic VPS:

1. Push the folder to GitHub
2. Create a new Node service
3. Set `GEMINI_API_KEY` in the platform environment settings
4. Start command: `npm start`

### Render

This repo includes `render.yaml`, so Render can read the service settings automatically.

1. Open Render and choose `New +` -> `Blueprint`
2. Connect the GitHub repo
3. Select `NullMetric/Serenity`
4. Add the secret env var `GEMINI_API_KEY`
5. Deploy

## Important Safety Notes

- Serenity is not a substitute for licensed mental health care
- The AI is instructed not to diagnose, prescribe, or act as a crisis line
- If a user expresses immediate self-harm intent or danger, the UI and API both steer them to emergency resources
