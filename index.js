require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const FIAT = process.env.FIAT || 'DZD';
const TARGET_PRICE = parseFloat(process.env.TARGET_PRICE) || 245;
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS) || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const TELEGRAM_USERNAME = process.env.TELEGRAM_USERNAME;
const IGNORED_MERCHANTS = process.env.IGNORED_MERCHANTS ? process.env.IGNORED_MERCHANTS.split(',').map(m => m.trim()) : [];
const BUY_AMOUNT_DZD = parseFloat(process.env.BUY_AMOUNT_DZD) || 10000;

let alertedAds = new Set(); // To remember ads we already alerted about

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

// Function to send Discord webhook message
async function sendDiscordAlert(ad) {
    if (!DISCORD_WEBHOOK_URL) return;

    const message = {
        "content": `🚨 **تنبيه سعر USDT منخفض!** 🚨\n@everyone`,
        "embeds": [
            {
                "title": `سعر جديد: ${ad.adv.price} DZD`,
                "description": `البائع: **${ad.advertiser.nickName}**\nالكمية المتاحة: ${ad.adv.surplusAmount} USDT\nطرق الدفع: ${ad.adv.tradeMethods.map(m => m.tradeMethodName).join(', ')}`,
                "color": 5814783,
                "url": "https://p2p.binance.com/en/trade/all-payments/USDT?fiat=DZD",
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            body: JSON.stringify(message)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[Discord] Webhook Error ${response.status}: ${errText}`);
        } else {
            console.log(`[Discord] Alert sent for ad: ${ad.adv.advNo}`);
        }
    } catch (error) {
        console.error("Discord Webhook Error:", error);
    }
}

// Function to make Telegram Voice Call via CallMeBot
async function makeTelegramCall(ad) {
    if (!TELEGRAM_USERNAME || TELEGRAM_USERNAME === '@your_username') return;

    const textToSpeak = encodeURIComponent(
        `Alert. Binance P 2 P USDT price is ${ad.adv.price} DZD. Please check your Discord.`
    );

    // Using English voice to ensure maximum compatibility
    const url = `http://api.callmebot.com/start.php?user=${TELEGRAM_USERNAME}&text=${textToSpeak}&lang=en-GB-Standard-B&rpt=2`;

    try {
        const response = await fetch(url);
        const text = await response.text();
        console.log(`[CallMeBot] Telegram Call API answered: ${response.status}`);
    } catch (error) {
        console.error("CallMeBot Telegram Error:", error);
    }
}

// Main polling function
async function checkBinanceP2P() {
    try {
        console.log(`[${new Date().toLocaleTimeString()}] Checking Binance P2P... Target: <= ${TARGET_PRICE} DZD`);
        const response = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const json = await response.json();

        if (json.data && json.data.length > 0) {
            // Find the lowest price ad containing our desired paytypes
            for (const ad of json.data) {
                const price = parseFloat(ad.adv.price);
                const advNo = ad.adv.advNo;
                const nickName = ad.advertiser.nickName;

                // تخطي التجار الممنوعين (Restricted) الموجودين في ملف الإعدادات
                if (IGNORED_MERCHANTS.includes(nickName)) {
                    continue;
                }

                // التحقق من الحد الأدنى للكمية المسموح شراؤها من طرف التاجر
                const minLimit = parseFloat(ad.adv.minSingleTransAmount);
                if (BUY_AMOUNT_DZD < minLimit) {
                    continue; // هذا التاجر يطلب مبلغاً أكبر بكثير كحد أدنى
                }

                if (price <= TARGET_PRICE) {
                    if (!alertedAds.has(advNo)) {
                        console.log(`\n!!! MATCH FOUND !!! Price: ${price} DZD by ${ad.advertiser.nickName}`);

                        alertedAds.add(advNo);

                        // Send alerts
                        await sendDiscordAlert(ad);
                        await makeTelegramCall(ad);

                        // Clear the memory after a while (e.g., 30 minutes) to avoid infinite growing Set
                        // Or if the ad is reposted, alert again.
                        setTimeout(() => alertedAds.delete(advNo), 30 * 60 * 1000);

                        // نكتفي بإرسال أفضل عرض فقط لتجنب الحظر من ديسكورد أو وتيليجرام بسبب كثرة الرسائل
                        break;
                    }
                } else {
                    // Since Binance returns them sorted by lowest price, if the first one is > target, all others are too.
                    break;
                }
            }
        }
    } catch (err) {
        console.error("Error fetching Binance:", err.message);
    }
}

// Start polling
setInterval(checkBinanceP2P, CHECK_INTERVAL_MS);
checkBinanceP2P(); // initial run

// Create a basic web server to keep the bot alive on free hosting (like Render.com)
app.get('/', (req, res) => {
    res.send('Binance P2P Bot is running and monitoring prices!');
});

app.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT} to keep bot awake.`);
});
