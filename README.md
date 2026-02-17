# AIM Chat WebSocket Server

WebSocket server for the AIM-style chat application.

## Deployment to Railway

### 1. Create a New Project
```bash
# Install Railway CLI if not already installed
npm install -g @railway/cli

# Login to Railway
railway login

# Create new project (or link to existing)
railway init
```

### 2. Deploy the WebSocket Server
```bash
# Add this directory as a service
railway add

# Deploy
railway up
```

### 3. Environment Variables
Set these in Railway dashboard:
- `PORT` - Will be set automatically by Railway (default: 8080)
- `NODE_ENV` - Set to `production`
- `DB_PATH` - Path to SQLite database (use Railway volumes for persistence)

### 4. Database Persistence
For production, you should:
1. Create a Railway Volume and mount it
2. Set `DB_PATH` to the mounted volume path (e.g., `/data/chatrooms.db`)

### 5. Health Check
The server exposes a health check endpoint at `/health`

## Local Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Or run production server
npm start
```

## WebSocket Protocol

### Client -> Server Messages:
- `identify` - Identify user on connection
- `join_room` - Join a chat room
- `leave_room` - Leave a chat room
- `message` - Send message to room
- `typing` - Typing indicator
- `direct_message` - Send DM to user
- `get_dm_history` - Get DM history
- `direct_typing` - DM typing indicator

### Server -> Client Messages:
- `message` - New message in room
- `join` - User joined room
- `leave` - User left room
- `typing` - Typing indicator update
- `active_users` - List of online users
- `direct_message` - Incoming DM
- `direct_message_sent` - DM sent confirmation
- `direct_message_history` - DM history
- `error` - Error message

## Architecture

- **WebSocket Server**: Node.js + ws library (this service)
- **Database**: SQLite (shared with PHP backend)
- **Authentication**: Session-based via PHP backend
- **Real-time**: WebSocket for chat, typing indicators, DMs
