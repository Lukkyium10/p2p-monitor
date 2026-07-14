require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const FIAT = process.env.FIAT || 'DZD';
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS) || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
// تم دمج اسمك واسم صديقك هنا مباشرة
const TELEGRAM_USERNAMES = ['@AmadiTosSS', '@Ggsnigga'];
const IGNORED_MERCHANTS = process.env.IGNORED_MERCHANTS ? process.env.IGNORED_MERCHANTS.split(',').map(m => m.trim()) : [];

let alertedBuyAds = new Set();
let lastTelegramCallTime = 0;
const TELEGRAM_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

// 1. دالة إرسال الإشعار إلى الديسكورد
async function sendDiscordAlert(ad) {
    if (!DISCORD_WEBHOOK_URL) return;

    const content = `🚨 **تنبيه فرصة ذهبية: سعر شراء USDT أقل من السوق بنسبة (1% إلى 10%)!** 🚨\n@everyone`;
    const titleDesc = `السعر المعروض للبيع: ${ad.adv.price} DZD`;
    const color = 5814783; // أزرق
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
            console.error(`[Discord] Webhook Error ${response.status}`);
        } else {
            console.log(`[Discord] Alert sent for BUY ad: ${ad.adv.advNo}`);
        }
    } catch (error) {
        console.error("Discord Webhook Error:", error);
    }
}

// 2. دالة الاتصال المزدوج على تليجرام
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

    for (const username of TELEGRAM_USERNAMES) {
        const url = `http://api.callmebot.com/start.php?user=${username}&text=${textToSpeak}&lang=en-GB-Standard-B&rpt=2`;

        try {
            const response = await fetch(url);
            await response.text();
            console.log(`[CallMeBot] Called ${username}. Status: ${response.status}`);
        } catch (error) {
            console.error(`CallMeBot Telegram Error for ${username}:`, error);
        }
        
        // انتظار ثانيتين بين اتصالك واتصال صديقك لتجنب الحظر
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

// 3. دالة فحص السوق
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
            "payTypes": ["AlgerieBaridimob", "AlgeriaPosteCCP"] // يمكنك تعديل طرق الدفع هنا
        };

        const response = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const json = await response.json();

        if (json.data && json.data.length > 0) {
            // حساب متوسط السوق
            let totalPrice = 0;
            for (const ad of json.data) {
                totalPrice += parseFloat(ad.adv.price);
            }
            const marketAverage = totalPrice / json.data.length;

            // تحديد النطاق (أقل بـ 1% كحد أعلى، وأقل بـ 10% كحد أدنى)
            const maxPriceAllowed = marketAverage * 0.99; 
            const minPriceAllowed = marketAverage * 0.90; 

            console.log(`[${new Date().toLocaleTimeString()}] Market Avg: ${marketAverage.toFixed(2)} DZD | Target Range: [${minPriceAllowed.toFixed(2)} - ${maxPriceAllowed.toFixed(2)}] DZD`);

            for (const ad of json.data) {
                const price = parseFloat(ad.adv.price);
                const advNo = ad.adv.advNo;
                const nickName = ad.advertiser.nickName;

                if (IGNORED_MERCHANTS.includes(nickName)) continue;

                const maxLimit = parseFloat(ad.adv.dynamicMaxSingleTransAmount);
                const surplus = parseFloat(ad.adv.surplusAmount);
                
                // تجاهل العرض فقط إذا كانت الكمية المتوفرة لا تستحق (أقل من 5000 دج وأقل من 20 دولار)
                if (maxLimit < 5000 && surplus < 20) {
                    continue; 
                }

                // تم حذف شرط الميزانية (الحد الأدنى للتاجر) نهائياً

                // شرط السعر الذهبي
                if (price <= maxPriceAllowed && price >= minPriceAllowed) {
                    if (!alertedBuyAds.has(advNo)) {
                        console.log(`\n!!! MATCH FOUND (1% - 10% Drop) !!! Price: ${price} DZD by ${nickName}`);
                        alertedBuyAds.add(advNo);
                        
                        await sendDiscordAlert(ad);
                        await makeTelegramCalls(ad); 
                        
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

// بدء الفحص المتكرر
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
