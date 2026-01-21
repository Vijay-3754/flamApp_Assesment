# Deployment Guide

This guide covers deploying the Collaborative Canvas application to Render (recommended) and other platforms.

## Prerequisites

- GitHub account
- Account on Render (https://render.com) - Free tier available

## Recommended: Render Deployment

### Step 1: Create Render Account

1. Go to **Render**: https://render.com
2. Sign up with your GitHub account
3. Authorize Render to access your repositories

### Step 2: Deploy from GitHub

1. **Create New Web Service**:
   - Click "New +" → "Web Service"
   - Select "Connect GitHub" (if not already connected)
   - Find and select: `Vijay-3754/flamApp_Assesment`

2. **Configure Service**:
   - **Name**: `collaborative-canvas` (or your preferred name)
   - **Environment**: Node
   - **Region**: Choose closest to you (e.g., Singapore, US East)
   - **Branch**: `main`
   - **Root Directory**: Leave blank (root)
   - **Build Command**: `npm run build`
   - **Start Command**: `node dist/server.js`
   - **Instance Type**: Free tier (or choose paid for better performance)

3. **Environment Variables** (usually not needed):
   - `PORT` - Render sets this automatically
   - `NODE_ENV` - Set to `production` (optional, already in render.yaml)

4. **Deploy**:
   - Click "Create Web Service"
   - Render will automatically:
     - Install dependencies (`npm install`)
     - Build the project (`npm run build`)
     - Start the server (`node dist/server.js`)
   - Wait 3-5 minutes for first deployment

5. **Get Your URL**:
   - After deployment, you'll get a URL like:
     - `https://collaborative-canvas.onrender.com`
     - Or your custom subdomain
   - Copy this URL for your demo link

### Step 3: Verify Deployment

1. Open the Render URL in your browser
2. Test the collaborative canvas
3. Open in multiple tabs to verify real-time sync
4. Test undo/redo functionality

### Render Features

- ✅ Free tier available
- ✅ Automatic SSL certificates
- ✅ WebSocket support
- ✅ Auto-deploy on git push (if enabled)
- ✅ Custom domains support (paid plans)
- ✅ Build logs and deployment history

---

## Alternative Deployment Options

### Option 1: Heroku

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

### Option 2: DigitalOcean App Platform

1. **Go to DigitalOcean**: https://cloud.digitalocean.com

2. **Create App**:
   - Connect GitHub repository
   - Select repository

3. **Configure**:
   - Build command: `npm run build`
   - Run command: `node dist/server.js`

---

### Option 3: Vercel (Limited WebSocket Support)

**Note**: Vercel is optimized for serverless. WebSocket support requires special configuration.

1. **Install Vercel CLI**:
   ```bash
   npm i -g vercel
   ```

2. **Deploy**:
   ```bash
   vercel
   ```

---

## Environment Variables

Most platforms set `PORT` automatically. If you need to customize:

- **PORT**: Server port (default: 3000)
- **NODE_ENV**: Set to `production` for production builds

## Important Notes

1. **Build Process**: The `start` script in package.json automatically runs `npm run build` before starting the server. Render uses the separate commands in `render.yaml` for better control.

2. **WebSocket Support**: Ensure your deployment platform supports WebSockets:
   - ✅ Render (all tiers)
   - ✅ Heroku (all tiers)
   - ✅ DigitalOcean App Platform
   - ⚠️ Vercel (requires special configuration)

3. **Free Tier Limitations**:
   - Render: Free tier available with limitations (sleeps after inactivity)
   - Heroku: Sleeps after 30 min inactivity (free tier changes)
   - DigitalOcean: Paid plans only

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
- Server uses `process.env.PORT || 3000` (already configured)

## Auto-Deploy Setup (Render)

To enable auto-deploy on git push:

1. Go to your Render service
2. Settings → Auto-Deploy
3. Enable "Auto-Deploy"
4. Every push to `main` branch will trigger a new deployment
