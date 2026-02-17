# DEPLOYMENT GUIDE - AIM Chat App

## ✅ What Was Fixed

### Security Issues Resolved:
1. **Password Hashing**: Changed from SHA256 to bcrypt with cost factor 12
2. **Input Sanitization**: Added sanitization for all user inputs
3. **SQL Injection Protection**: Using parameterized queries throughout
4. **Git Security**: Created .gitignore to prevent database/logs from being committed
5. **Session Security**: Passwords no longer sent to client

### Missing Components Added:
1. **WebSocket Server** (`server.js`): Complete Node.js WebSocket implementation
2. **Package.json**: Dependencies for ws, sqlite3, uuid
3. **Railway Config**: `railway.toml` for easy deployment
4. **Documentation**: README with setup instructions

---

## 🚀 Deploy to Railway

### Option A: Deploy via Railway Dashboard (Easiest)

1. **Push to GitHub first** (see GitHub section below)
2. Go to https://railway.app
3. Click "New Project"
4. Select "Deploy from GitHub repo"
5. Choose your repository
6. Railway will auto-detect the `railway.toml` config
7. Add environment variables in Railway Dashboard:
   - `NODE_ENV=production`
8. Deploy!

### Option B: Deploy via Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project (if already created)
railway link

# Or create new project
railway init

# Deploy
railway up
```

### After Deployment:

1. Railway will give you a URL like `https://your-app.up.railway.app`
2. **Update the frontend**: Edit `script.js` line 1643:
   ```javascript
   const host = 'your-app.up.railway.app'; // Replace with your Railway URL
   ```
3. Commit and push the change
4. Redeploy if needed

---

## 📦 Push to GitHub

```bash
# Add remote repository
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Push to main branch
git push -u origin main
```

**IMPORTANT**: Database file is excluded via .gitignore (good!)

---

## 🔧 Post-Deployment Configuration

### Database Persistence on Railway:
For production, you need persistent storage:

1. In Railway Dashboard, go to your service
2. Click "Volumes" tab
3. Add a volume (mount path: `/data`)
4. Update environment variable: `DB_PATH=/data/chatrooms.db`

### Environment Variables:
Set these in Railway Dashboard:
- `NODE_ENV=production`
- `DB_PATH=/data/chatrooms.db` (if using volumes)
- `PORT` (Railway sets this automatically)

---

## 🔒 Security Checklist

- ✅ Passwords hashed with bcrypt
- ✅ Database file excluded from git
- ✅ Input sanitization on all user data
- ✅ SQL injection protection
- ✅ Session-based authentication
- ✅ CORS headers configured
- ✅ Health check endpoint at `/health`

---

## 📋 Files Created/Modified

**New Files:**
- `.gitignore` - Protects sensitive files
- `server.js` - WebSocket server
- `package.json` - Node.js dependencies
- `railway.toml` - Railway deployment config
- `README.md` - Documentation

**Modified Files:**
- `backend.php` - bcrypt password hashing, security improvements
- `script.js` - WebSocket URL configuration

---

## 🎯 Next Steps

1. ✅ Commit and push to GitHub
2. ✅ Deploy to Railway
3. ✅ Update WebSocket URL in script.js with Railway domain
4. ✅ Set up Railway Volume for database persistence
5. ✅ Test the chat functionality

---

## ⚠️ Important Notes

- **Database**: SQLite database is NOT committed to git (for security)
- **Passwords**: Old SHA256 passwords won't work - users need to re-register
- **WebSocket**: Must update the URL in script.js after Railway deployment
- **Static Files**: Your PHP frontend can stay on current hosting (chat.laloadrianmorales.com)
- **WebSocket Only**: Railway will host just the WebSocket server

---

## 🆘 Troubleshooting

### WebSocket won't connect:
- Check that Railway service is running
- Verify WebSocket URL in script.js matches Railway domain
- Check browser console for CORS errors

### Database issues:
- Ensure DB_PATH environment variable is set
- Check Railway logs for SQLite errors

### Password login fails:
- bcrypt is now required - old SHA256 passwords won't work
- Users need to re-register with new passwords

---

**Questions? Check the README.md file for more details.**
