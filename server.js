const WebSocket = require('ws');
const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = process.env.PORT || 8080;
const DB_PATH = process.env.DB_PATH || './chatrooms.db';

// Validate and sanitize input
function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>\"']/g, '').trim().substring(0, 1000);
}

function sanitizeNickname(nickname) {
    if (typeof nickname !== 'string') return '';
    // Allow alphanumeric, spaces, dashes, underscores
    return nickname.replace(/[^a-zA-Z0-9\s_-]/g, '').trim().substring(0, 30);
}

// Initialize database connection
let db;
try {
    // Check if database exists
    if (!fs.existsSync(DB_PATH)) {
        console.error(`Database not found at ${DB_PATH}`);
        console.log('Creating new database...');
    }
    
    db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
            console.error('Error opening database:', err.message);
            process.exit(1);
        }
        console.log('Connected to SQLite database');
    });
    
    // Create tables if they don't exist
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            user_nickname TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_id) REFERENCES rooms(id)
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS direct_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user TEXT NOT NULL,
            to_user TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        // Insert default rooms if none exist
        db.get('SELECT COUNT(*) as count FROM rooms', (err, row) => {
            if (err) {
                console.error('Error checking rooms:', err);
                return;
            }
            if (row.count === 0) {
                const defaultRooms = ['Main Lobby', 'Tech Talk', 'Gaming Zone', 'Movies & TV'];
                const stmt = db.prepare('INSERT INTO rooms (name) VALUES (?)');
                defaultRooms.forEach(room => {
                    stmt.run(room);
                });
                stmt.finalize();
                console.log('Created default rooms');
            }
        });
    });
} catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
}

// Store connected clients
const clients = new Map(); // nickname -> {ws, rooms, profile, lastActivity}
const rooms = new Map(); // roomId -> Set of nicknames

// Create HTTP server for health checks
const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            connections: clients.size,
            uptime: process.uptime()
        }));
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// Create WebSocket server
const wss = new WebSocket.Server({ 
    server,
    // Allow connections from any origin (configure for production)
    verifyClient: (info) => {
        // You can add origin validation here for production
        return true;
    }
});

// Broadcast active users list to all connected clients
function broadcastActiveUsers() {
    const activeUsers = Array.from(clients.entries()).map(([nickname, client]) => ({
        nickname: nickname,
        status: client.profile?.status || 'online',
        avatarColor: client.profile?.avatarColor || '#' + Math.floor(Math.random()*16777215).toString(16),
        lastActive: new Date(client.lastActivity).toISOString()
    }));
    
    const message = JSON.stringify({
        type: 'active_users',
        users: activeUsers
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Broadcast to all clients in a room
function broadcastToRoom(roomId, message, excludeNickname = null) {
    const roomClients = rooms.get(roomId);
    if (!roomClients) return;
    
    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    
    roomClients.forEach(nickname => {
        if (excludeNickname && nickname === excludeNickname) return;
        
        const client = clients.get(nickname);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(messageStr);
        }
    });
}

// Save message to database
function saveMessage(roomId, nickname, message) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(
            'INSERT INTO messages (room_id, user_nickname, message) VALUES (?, ?, ?)'
        );
        stmt.run([roomId, nickname, message], function(err) {
            if (err) {
                console.error('Error saving message:', err);
                reject(err);
            } else {
                resolve(this.lastID);
            }
        });
        stmt.finalize();
    });
}

// Save direct message to database
function saveDirectMessage(from, to, message) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(
            'INSERT INTO direct_messages (from_user, to_user, message) VALUES (?, ?, ?)'
        );
        stmt.run([from, to, message], function(err) {
            if (err) {
                console.error('Error saving direct message:', err);
                reject(err);
            } else {
                resolve(this.lastID);
            }
        });
        stmt.finalize();
    });
}

// Get direct message history
function getDirectMessageHistory(user1, user2, limit = 50) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT * FROM direct_messages 
             WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
             ORDER BY timestamp DESC LIMIT ?`,
            [user1, user2, user2, user1, limit],
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows.reverse());
                }
            }
        );
    });
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection from:', req.socket.remoteAddress);
    
    let clientNickname = null;
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            
            // Update last activity
            if (clientNickname && clients.has(clientNickname)) {
                clients.get(clientNickname).lastActivity = Date.now();
            }
            
            switch (message.type) {
                case 'identify': {
                    // Client identifies itself
                    const nickname = sanitizeNickname(message.nickname);
                    
                    if (!nickname) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Invalid nickname'
                        }));
                        return;
                    }
                    
                    // Check if nickname is already taken
                    if (clients.has(nickname) && clients.get(nickname).ws !== ws) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Nickname already in use'
                        }));
                        ws.close();
                        return;
                    }
                    
                    // Remove old entry if reconnecting
                    if (clientNickname && clientNickname !== nickname) {
                        leaveAllRooms(clientNickname);
                        clients.delete(clientNickname);
                    }
                    
                    clientNickname = nickname;
                    clients.set(nickname, {
                        ws: ws,
                        rooms: new Set(),
                        profile: {
                            displayName: sanitizeInput(message.displayName) || nickname,
                            status: sanitizeInput(message.status) || 'online',
                            avatarColor: message.avatarColor || '#' + Math.floor(Math.random()*16777215).toString(16)
                        },
                        lastActivity: Date.now()
                    });
                    
                    console.log(`User identified: ${nickname}`);
                    
                    // Broadcast updated active users list
                    broadcastActiveUsers();
                    break;
                }
                
                case 'join_room': {
                    if (!clientNickname) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Not identified'
                        }));
                        return;
                    }
                    
                    const roomId = parseInt(message.roomId);
                    if (isNaN(roomId)) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Invalid room ID'
                        }));
                        return;
                    }
                    
                    const client = clients.get(clientNickname);
                    
                    // Leave current room if in one
                    if (client.rooms.has(roomId)) {
                        return; // Already in this room
                    }
                    
                    // Initialize room if needed
                    if (!rooms.has(roomId)) {
                        rooms.set(roomId, new Set());
                    }
                    
                    // Add to room
                    rooms.get(roomId).add(clientNickname);
                    client.rooms.add(roomId);
                    
                    console.log(`${clientNickname} joined room ${roomId}`);
                    
                    // Notify others in room
                    broadcastToRoom(roomId, {
                        type: 'join',
                        roomId: roomId,
                        nickname: clientNickname,
                        userCount: rooms.get(roomId).size
                    }, clientNickname);
                    
                    // Send confirmation to user
                    ws.send(JSON.stringify({
                        type: 'joined',
                        roomId: roomId
                    }));
                    
                    break;
                }
                
                case 'leave_room': {
                    if (!clientNickname) return;
                    
                    const roomId = parseInt(message.roomId);
                    if (isNaN(roomId)) return;
                    
                    leaveRoom(clientNickname, roomId);
                    break;
                }
                
                case 'message': {
                    if (!clientNickname) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Not identified'
                        }));
                        return;
                    }
                    
                    const roomId = parseInt(message.roomId);
                    const content = sanitizeInput(message.message);
                    
                    if (isNaN(roomId) || !content) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Invalid message data'
                        }));
                        return;
                    }
                    
                    const client = clients.get(clientNickname);
                    if (!client.rooms.has(roomId)) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Not in room'
                        }));
                        return;
                    }
                    
                    // Save to database
                    try {
                        const messageId = await saveMessage(roomId, clientNickname, content);
                        
                        // Broadcast to room
                        broadcastToRoom(roomId, {
                            type: 'message',
                            roomId: roomId,
                            nickname: clientNickname,
                            message: content,
                            timestamp: new Date().toISOString(),
                            messageId: messageId
                        });
                    } catch (err) {
                        console.error('Failed to save/broadcast message:', err);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Failed to send message'
                        }));
                    }
                    
                    break;
                }
                
                case 'typing': {
                    if (!clientNickname) return;
                    
                    const roomId = parseInt(message.roomId);
                    if (isNaN(roomId)) return;
                    
                    const client = clients.get(clientNickname);
                    if (!client.rooms.has(roomId)) return;
                    
                    broadcastToRoom(roomId, {
                        type: 'typing',
                        roomId: roomId,
                        nickname: clientNickname,
                        isTyping: message.isTyping
                    }, clientNickname);
                    
                    break;
                }
                
                case 'direct_message': {
                    if (!clientNickname) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Not identified'
                        }));
                        return;
                    }
                    
                    const to = sanitizeNickname(message.to);
                    const content = sanitizeInput(message.message);
                    
                    if (!to || !content) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Invalid direct message data'
                        }));
                        return;
                    }
                    
                    try {
                        // Save to database
                        await saveDirectMessage(clientNickname, to, content);
                        
                        const messageData = {
                            type: 'direct_message',
                            from: clientNickname,
                            message: content,
                            timestamp: new Date().toISOString()
                        };
                        
                        // Send to recipient if online
                        const recipient = clients.get(to);
                        if (recipient && recipient.ws.readyState === WebSocket.OPEN) {
                            recipient.ws.send(JSON.stringify(messageData));
                        }
                        
                        // Send confirmation to sender
                        ws.send(JSON.stringify({
                            type: 'direct_message_sent',
                            to: to,
                            message: content,
                            timestamp: new Date().toISOString()
                        }));
                        
                    } catch (err) {
                        console.error('Failed to send direct message:', err);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Failed to send direct message'
                        }));
                    }
                    
                    break;
                }
                
                case 'get_dm_history': {
                    if (!clientNickname) return;
                    
                    const withUser = sanitizeNickname(message.with);
                    if (!withUser) return;
                    
                    try {
                        const history = await getDirectMessageHistory(clientNickname, withUser);
                        ws.send(JSON.stringify({
                            type: 'direct_message_history',
                            with: withUser,
                            messages: history
                        }));
                    } catch (err) {
                        console.error('Failed to get DM history:', err);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Failed to load message history'
                        }));
                    }
                    
                    break;
                }
                
                case 'direct_typing': {
                    if (!clientNickname) return;
                    
                    const to = sanitizeNickname(message.to);
                    if (!to) return;
                    
                    const recipient = clients.get(to);
                    if (recipient && recipient.ws.readyState === WebSocket.OPEN) {
                        recipient.ws.send(JSON.stringify({
                            type: 'direct_typing',
                            from: clientNickname
                        }));
                    }
                    
                    break;
                }
                
                default:
                    console.log('Unknown message type:', message.type);
            }
        } catch (err) {
            console.error('Error handling message:', err);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    });
    
    ws.on('close', () => {
        if (clientNickname) {
            console.log(`User disconnected: ${clientNickname}`);
            leaveAllRooms(clientNickname);
            clients.delete(clientNickname);
            broadcastActiveUsers();
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        if (clientNickname) {
            leaveAllRooms(clientNickname);
            clients.delete(clientNickname);
        }
    });
});

// Helper function to leave a room
function leaveRoom(nickname, roomId) {
    const client = clients.get(nickname);
    if (!client) return;
    
    if (rooms.has(roomId)) {
        rooms.get(roomId).delete(nickname);
        
        // Notify others
        broadcastToRoom(roomId, {
            type: 'leave',
            roomId: roomId,
            nickname: nickname,
            userCount: rooms.get(roomId).size
        });
        
        // Clean up empty rooms (except default rooms 1-4)
        if (rooms.get(roomId).size === 0 && roomId > 4) {
            rooms.delete(roomId);
        }
    }
    
    client.rooms.delete(roomId);
}

// Helper function to leave all rooms
function leaveAllRooms(nickname) {
    const client = clients.get(nickname);
    if (!client) return;
    
    client.rooms.forEach(roomId => {
        if (rooms.has(roomId)) {
            rooms.get(roomId).delete(nickname);
            
            broadcastToRoom(roomId, {
                type: 'leave',
                roomId: roomId,
                nickname: nickname,
                userCount: rooms.get(roomId).size
            });
            
            if (rooms.get(roomId).size === 0 && roomId > 4) {
                rooms.delete(roomId);
            }
        }
    });
    
    client.rooms.clear();
}

// Cleanup inactive clients every 5 minutes
setInterval(() => {
    const now = Date.now();
    const timeout = 10 * 60 * 1000; // 10 minutes
    
    clients.forEach((client, nickname) => {
        if (now - client.lastActivity > timeout) {
            console.log(`Removing inactive client: ${nickname}`);
            client.ws.close();
            leaveAllRooms(nickname);
            clients.delete(nickname);
        }
    });
    
    broadcastActiveUsers();
}, 5 * 60 * 1000);

// Start server
server.listen(PORT, () => {
    console.log(`WebSocket server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    
    wss.clients.forEach(client => {
        client.close();
    });
    
    server.close(() => {
        db.close(() => {
            console.log('Database connection closed');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    
    wss.clients.forEach(client => {
        client.close();
    });
    
    server.close(() => {
        db.close(() => {
            console.log('Database connection closed');
            process.exit(0);
        });
    });
});
