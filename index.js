require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const FIAT = process.env.FIAT || 'DZD';
const TARGET_PRICE = parseFloat(process.env.TARGET_PRICE) || 245;
const SELL_TARGET_PRICE = parseFloat(process.env.SELL_TARGET_PRICE) || 248;
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS) || 5000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const TELEGRAM_USERNAME = process.env.TELEGRAM_USERNAME;
const IGNORED_MERCHANTS = process.env.IGNORED_MERCHANTS ? process.env.IGNORED_MERCHANTS.split(',').map(m => m.trim()) : [];
const BUY_AMOUNT_DZD = parseFloat(process.env.BUY_AMOUNT_DZD) || 10000;
const SELL_AMOUNT_DZD = parseFloat(process.env.SELL_AMOUNT_DZD) || 10000;

let alertedBuyAds = new Set();
let alertedSellAds = new Set();
let lastTelegramCallTime = 0;
const TELEGRAM_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

// Function to send Discord webhook message
async function sendDiscordAlert(ad, type = "BUY") {
    if (!DISCORD_WEBHOOK_URL) return;

    let content, titleDesc, color, url;
    if (type === "BUY") {
        content = `🚨 **تنبيه سعر شراء USDT ممتاز!** 🚨\n@everyone`;
        titleDesc = `السعر المعروض للبيع: ${ad.adv.price} DZD`;
        color = 5814783; // Blue
        url = "https://p2p.binance.com/en/trade/all-payments/USDT?fiat=DZD";
    } else {
        content = `💰 **تنبيه فرصة بيع USDT ممتازة!** 💰\n@everyone`;
        titleDesc = `السعر المعروض للشراء (بيعك للـ USDT): ${ad.adv.price} DZD`;
        color = 15158332; // Orange
        url = "https://p2p.binance.com/en/trade/sell/USDT?fiat=DZD&payment=AlgerieBaridimob";
    }

    const message = {
        "content": content,
        "embeds": [
            {
                "title": titleDesc,
                "description": `التاجر: **${ad.advertiser.nickName}**\nالكمية المتاحة: ${ad.adv.surplusAmount} USDT\nطرق الدفع: ${ad.adv.tradeMethods.map(m => m.tradeMethodName).join(', ')}\nالحد الأدنى للطلب: ${ad.adv.minSingleTransAmount} DZD\nالحد الأقصى للطلب: ${ad.adv.dynamicMaxSingleTransAmount} DZD`,
                "color": color,
                "url": url,
                "footer": {
                    "text": "Binance P2P Monitor Bot"
                },
                "timestamp": new Date().toISOString()
            }
        ]
    };

    try {
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            body: JSON.stringify(message)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[Discord] Webhook Error ${response.status}: ${errText}`);
        } else {
            console.log(`[Discord] Alert sent for ${type} ad: ${ad.adv.advNo}`);
        }
    } catch (error) {
        console.error("Discord Webhook Error:", error);
    }
}

// Function to make Telegram Voice Call via CallMeBot
async function makeTelegramCall(ad, type = "BUY") {
    if (!TELEGRAM_USERNAME || TELEGRAM_USERNAME === '@your_username') return;

    const now = Date.now();
    if (now - lastTelegramCallTime < TELEGRAM_COOLDOWN_MS) {
        console.log(`[Telegram] Skipping call to avoid rate limit (2m cooldown).`);
        return;
    }
    lastTelegramCallTime = now;

    const actionText = type === "BUY" ? "buy" : "sell";
    const textToSpeak = encodeURIComponent(
        `Alert. Binance P 2 P USDT ${actionText} price is ${ad.adv.price} D Z D.`
    );

    const url = `http://api.callmebot.com/start.php?user=${TELEGRAM_USERNAME}&text=${textToSpeak}&lang=en-GB-Standard-B&rpt=2`;

    try {
        const response = await fetch(url);
        const text = await response.text();
        console.log(`[CallMeBot] Telegram Call API answered: ${response.status}`);
    } catch (error) {
        console.error("CallMeBot Telegram Error:", error);
    }
}

// Function to check Buying context (Advertisers who are selling USDT)
async function checkBinanceP2P_BUY() {
    try {
        const payload = {
            "fiat": FIAT,
            "page": 1,
            "rows": 10,
            "tradeType": "BUY",
            "asset": "USDT",
            "countries": [],
            "proMerchantAds": false,
            "shieldMerchantAds": false,
            "publisherType": null,
            "payTypes": ["AlgerieBaridimob", "AlgeriaPosteCCP"]
        };

        const response = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const json = await response.json();

        if (json.data && json.data.length > 0) {
            for (const ad of json.data) {
                const price = parseFloat(ad.adv.price);
                const advNo = ad.adv.advNo;
                const nickName = ad.advertiser.nickName;

                if (IGNORED_MERCHANTS.includes(nickName)) continue;

                const minLimit = parseFloat(ad.adv.minSingleTransAmount);
                if (BUY_AMOUNT_DZD < minLimit) continue; 

                const maxLimit = parseFloat(ad.adv.dynamicMaxSingleTransAmount);
                if (BUY_AMOUNT_DZD > maxLimit) continue; 

                if (price <= TARGET_PRICE) {
                    if (!alertedBuyAds.has(advNo)) {
                        console.log(`\n!!! BUY MATCH FOUND !!! Price: ${price} DZD by ${nickName}`);
                        alertedBuyAds.add(advNo);
                        await sendDiscordAlert(ad, "BUY");
                        await makeTelegramCall(ad, "BUY");
                        setTimeout(() => alertedBuyAds.delete(advNo), 30 * 60 * 1000);
                    }
                    break;
                } else {
                    break;
                }
            }
        }
    } catch (err) {
        console.error("Error fetching Binance BUY:", err.message);
    }
}

// Function to check Selling context (Advertisers who are buying USDT)
async function checkBinanceP2P_SELL() {
    try {
        const payload = {
            "fiat": FIAT,
            "page": 1,
            "rows": 10,
            "tradeType": "SELL",
            "asset": "USDT",
            "countries": [],
            "proMerchantAds": false,
            "shieldMerchantAds": false,
            "publisherType": null,
            "payTypes": ["AlgerieBaridimob"] // Only baridimob
        };

        const response = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const json = await response.json();

        if (json.data && json.data.length > 0) {
            for (const ad of json.data) {
                const price = parseFloat(ad.adv.price);
                const advNo = ad.adv.advNo;
                const nickName = ad.advertiser.nickName;

                if (IGNORED_MERCHANTS.includes(nickName)) continue;

                const minLimit = parseFloat(ad.adv.minSingleTransAmount);
                const maxLimit = parseFloat(ad.adv.dynamicMaxSingleTransAmount);
                
                if (SELL_AMOUNT_DZD < minLimit) continue; 
                if (SELL_AMOUNT_DZD > maxLimit) continue;

                if (price >= SELL_TARGET_PRICE) {
                    if (!alertedSellAds.has(advNo)) {
                        console.log(`\n!!! SELL MATCH FOUND !!! Price: ${price} DZD by ${nickName}`);
                        alertedSellAds.add(advNo);
                        await sendDiscordAlert(ad, "SELL");
                        await makeTelegramCall(ad, "SELL");
                        setTimeout(() => alertedSellAds.delete(advNo), 30 * 60 * 1000);
                    }
                    break;
                } else {
                    break;
                }
            }
        }
    } catch (err) {
        console.error("Error fetching Binance SELL:", err.message);
    }
}

// Start polling
async function loop() {
    console.log(`[${new Date().toLocaleTimeString()}] Checking Binance P2P... Target BUY <= ${TARGET_PRICE} | Target SELL >= ${SELL_TARGET_PRICE}`);
    await checkBinanceP2P_BUY();
    await checkBinanceP2P_SELL();
}

setInterval(loop, CHECK_INTERVAL_MS);
loop(); // initial run

app.get('/', (req, res) => {
    res.send('Binance P2P Bot is running and monitoring prices for both BUY and SELL!');
});

app.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT} to keep bot awake.`);
});
