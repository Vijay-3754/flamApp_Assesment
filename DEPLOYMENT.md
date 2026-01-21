# Deployment Guide

This guide covers deploying the Collaborative Canvas application to various platforms.

## Prerequisites

- GitHub account
- Account on your chosen deployment platform (Heroku, Railway, Render, etc.)

## Deployment Options

### Option 1: Heroku (Recommended)

1. **Install Heroku CLI** (if not installed):
   ```bash
   # Windows
   # Download from https://devcenter.heroku.com/articles/heroku-cli
   ```

2. **Login to Heroku**:
   ```bash
   heroku login
   ```

3. **Create Heroku App**:
   ```bash
   heroku create your-app-name
   ```

4. **Push to Heroku**:
   ```bash
   git push heroku main
   # or if your branch is master:
   git push heroku master
   ```

5. **Set Environment Variables** (optional):
   ```bash
   heroku config:set PORT=3000
   ```

6. **Open App**:
   ```bash
   heroku open
   ```

**Note**: Heroku builds automatically using the `start` script in package.json.

---

### Option 2: Railway

1. **Go to Railway**: https://railway.app

2. **Connect GitHub Repository**:
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository

3. **Configure Build**:
   - Railway auto-detects Node.js
   - Build command: `npm run build` (optional, `npm start` already builds)
   - Start command: `node dist/server.js`

4. **Set Environment Variables** (optional):
   - `PORT`: Railway sets this automatically

5. **Deploy**: Railway will automatically deploy

---

### Option 3: Render

1. **Go to Render**: https://render.com

2. **Create New Web Service**:
   - Connect your GitHub repository
   - Select the repository

3. **Configure Service**:
   - **Name**: collaborative-canvas
   - **Environment**: Node
   - **Build Command**: `npm run build`
   - **Start Command**: `node dist/server.js`
   - **Instance Type**: Free tier available

4. **Deploy**: Click "Create Web Service"

---

### Option 4: Vercel (Requires Modification)

**Note**: Vercel is optimized for serverless, but we can deploy this with some adjustments.

1. **Install Vercel CLI**:
   ```bash
   npm i -g vercel
   ```

2. **Deploy**:
   ```bash
   vercel
   ```

3. **For WebSocket support**, consider using Vercel's serverless functions with WebSocket upgrade or use a different platform.

---

### Option 5: DigitalOcean App Platform

1. **Go to DigitalOcean**: https://cloud.digitalocean.com

2. **Create App**:
   - Connect GitHub repository
   - Select repository

3. **Configure**:
   - Build command: `npm run build`
   - Run command: `node dist/server.js`

---

## Environment Variables

Most platforms set `PORT` automatically. If you need to customize:

- **PORT**: Server port (default: 3000)

## Important Notes

1. **Build Process**: The `start` script in package.json automatically runs `npm run build` before starting the server, so deployment platforms should use `npm start`.

2. **WebSocket Support**: Ensure your deployment platform supports WebSockets:
   - ✅ Heroku (all tiers)
   - ✅ Railway
   - ✅ Render
   - ✅ DigitalOcean App Platform
   - ⚠️ Vercel (requires special configuration)

3. **Free Tier Limitations**:
   - Heroku: Sleeps after 30 min inactivity (free tier removed)
   - Railway: Limited hours/month on free tier
   - Render: Free tier available with limitations

## Testing Deployment

After deployment:

1. Visit your deployed URL
2. Open in multiple tabs/browsers
3. Test collaborative drawing
4. Verify real-time sync works
5. Test undo/redo across multiple clients

## Troubleshooting

**Build Fails**:
- Ensure TypeScript is installed (`npm install`)
- Check that `tsconfig.json` is present
- Verify all dependencies in `package.json`

**WebSocket Connection Fails**:
- Check platform supports WebSockets
- Verify CORS settings (if needed)
- Check firewall/network settings

**Port Errors**:
- Ensure platform sets `PORT` environment variable
- Update server.ts to use `process.env.PORT || 3000` (already done)
