require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const FIAT = process.env.FIAT || 'DZD';
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS) || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// قائمة بأسماء المستخدمين الذين سيتم الاتصال بهم (أنت وصديقك)
const TELEGRAM_USERNAMES = ['@AmadiTosSS', '@Ggsnigga'];

const IGNORED_MERCHANTS = process.env.IGNORED_MERCHANTS ? process.env.IGNORED_MERCHANTS.split(',').map(m => m.trim()) : [];
const BUY_AMOUNT_DZD = parseFloat(process.env.BUY_AMOUNT_DZD) || 2000;

let alertedBuyAds = new Set();
let lastTelegramCallTime = 0;
const TELEGRAM_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

// Function to send Discord webhook message
async function sendDiscordAlert(ad) {
    if (!DISCORD_WEBHOOK_URL) return;

    const content = `🚨 **تنبيه فرصة ذهبية: سعر شراء USDT أقل من السوق بنسبة (1% إلى 10%)!** 🚨\n@everyone`;
    const titleDesc = `السعر المعروض للبيع: ${ad.adv.price} DZD`;
    const color = 5814783; // Blue
    const url = "https://p2p.binance.com/en/trade/all-payments/USDT?fiat=DZD";

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
            console.log(`[Discord] Alert sent for BUY ad: ${ad.adv.advNo}`);
        }
    } catch (error) {
        console.error("Discord Webhook Error:", error);
    }
}

// Function to make Telegram Voice Calls
async function makeTelegramCalls(ad) {
    const now = Date.now();
    if (now - lastTelegramCallTime < TELEGRAM_COOLDOWN_MS) {
        console.log(`[Telegram] Skipping call to avoid rate limit (2m cooldown).`);
        return;
    }
    lastTelegramCallTime = now;

    const textToSpeak = encodeURIComponent(
        `Alert. Binance P 2 P USDT buy price is ${ad.adv.price} D Z D.`
    );

    // الاتصال بكل الأشخاص الموجودين في القائمة واحداً تلو الآخر
    for (const username of TELEGRAM_USERNAMES) {
        const url = `http://api.callmebot.com/start.php?user=${username}&text=${textToSpeak}&lang=en-GB-Standard-B&rpt=2`;

        try {
            const response = await fetch(url);
            await response.text();
            console.log(`[CallMeBot] Called ${username}. Status: ${response.status}`);
        } catch (error) {
            console.error(`CallMeBot Telegram Error for ${username}:`, error);
        }
        
        // انتظار ثانيتين بين المكالمة والأخرى لتجنب الحظر من الخادم
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

// Function to check Buying context
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
            // 1. حساب متوسط السوق
            let totalPrice = 0;
            for (const ad of json.data) {
                totalPrice += parseFloat(ad.adv.price);
            }
            const marketAverage = totalPrice / json.data.length;

            // 2. النطاق المستهدف [1% إلى 10%]
            const maxPriceAllowed = marketAverage * 0.99; 
            const minPriceAllowed = marketAverage * 0.90; 

            console.log(`[${new Date().toLocaleTimeString()}] Market Avg: ${marketAverage.toFixed(2)} DZD | Target Range: [${minPriceAllowed.toFixed(2)} - ${maxPriceAllowed.toFixed(2)}] DZD`);

            // 3. التحقق من العروض
            for (const ad of json.data) {
                const price = parseFloat(ad.adv.price);
                const advNo = ad.adv.advNo;
                const nickName = ad.advertiser.nickName;

                if (IGNORED_MERCHANTS.includes(nickName)) continue;

                const minLimit = parseFloat(ad.adv.minSingleTransAmount);
                if (BUY_AMOUNT_DZD < minLimit) continue; 

                const maxLimit = parseFloat(ad.adv.dynamicMaxSingleTransAmount);
                if (BUY_AMOUNT_DZD > maxLimit) continue; 

                if (price <= maxPriceAllowed && price >= minPriceAllowed) {
                    if (!alertedBuyAds.has(advNo)) {
                        console.log(`\n!!! MATCH FOUND (1% - 10% Drop) !!! Price: ${price} DZD by ${nickName}`);
                        alertedBuyAds.add(advNo);
                        
                        await sendDiscordAlert(ad);
                        await makeTelegramCalls(ad); // استدعاء دالة الاتصال المزدوج
                        
                        setTimeout(() => alertedBuyAds.delete(advNo), 30 * 60 * 1000);
                    }
                    break;
                }
            }
        }
    } catch (err) {
        console.error("Error fetching Binance BUY:", err.message);
    }
}

// Start polling
async function loop() {
    await checkBinanceP2P_BUY();
}

setInterval(loop, CHECK_INTERVAL_MS);
loop(); 

app.get('/', (req, res) => {
    res.send('Binance P2P Bot is running and monitoring for 1%-10% drops below market average!');
});

app.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT} to keep bot awake.`);
});
