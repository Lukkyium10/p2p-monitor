const data = {
  fiat: "DZD",
  rows: 20,
  tradeType: "BUY",
  asset: "USDT",
  countries: [],
  proMerchantAds: false,
  shieldMerchantAds: false,
  publisherType: null,
  payTypes: []
};

async function check() {
    try {
        const found = new Set();
        for(let page=1; page<=5; page++) {
            data.page = page;
            const response = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
            const json = await response.json();
            if (json.data) {
                for (const ad of json.data) {
                    const methods = ad.adv.tradeMethods || [];
                    for (const m of methods) {
                        if (!found.has(m.identifier)) {
                            console.log(m.identifier, "->", m.tradeMethodName);
                            found.add(m.identifier);
                        }
                    }
                }
            } else {
                console.log("Page", page, "Error:", json);
            }
        }
    } catch (e) {
        console.error("Error:", e);
    }
}
check();
