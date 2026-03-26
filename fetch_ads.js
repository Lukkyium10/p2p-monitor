const fs = require('fs');
fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
    method:'POST', 
    body: JSON.stringify({fiat:"DZD",tradeType:"BUY",asset:"USDT",payTypes:[],page:1,rows:50}), 
    headers:{'Content-Type':'application/json'}
}).then(r=>r.json()).then(j=>{
    if (j.data) {
        fs.writeFileSync('binance_ads.json', JSON.stringify(j.data, null, 2));
        console.log("Saved to binance_ads.json");
    }
});
