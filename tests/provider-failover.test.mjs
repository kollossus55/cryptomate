// Verify each provider's PARSING against real response shapes, with fetch stubbed.
const okxTickers = { code:'0', data:[
  { instId:'BTC-USDT', last:'64000.1', open24h:'62000', volCcy24h:'1500000000', high24h:'64500', low24h:'61800' },
  { instId:'ETH-USDT', last:'3200.5',  open24h:'3300',  volCcy24h:'800000000',  high24h:'3350',  low24h:'3180' },
  { instId:'BTC-USDC', last:'64010',   open24h:'62000', volCcy24h:'5000000',    high24h:'64500', low24h:'61800' },
]};
// OKX candles: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm] newest first
const okxCandles = { code:'0', data:[
  ['1700007200000','101','103','100','102','10','10','1020','0'],
  ['1700003600000','100','102','99','101','12','12','1212','1'],
  ['1700000000000','99','101','98','100','11','11','1100','1'],
]};
const cbCandles = [ [1700007200,100,103,101,102,10], [1700003600,99,102,100,101,12] ];

globalThis.fetch = async (url) => {
  const body =
    url.includes('okx.com/api/v5/market/tickers') ? okxTickers :
    url.includes('okx.com/api/v5/market/candles') ? okxCandles :
    url.includes('coinbase') && url.includes('/candles') ? cbCandles :
    (()=>{ throw new Error('geo-blocked 451'); })();
  return { ok:true, status:200, headers:{get:()=>null}, json: async()=>body };
};

const m = await import('/home/claude/v2/shared/trading/marketData.js');

let pass=0, fail=0;
const t=(n,fn)=>{ try{ fn(); pass++; console.log('  PASS  '+n);}catch(e){ fail++; console.log('  FAIL  '+n+'\n        '+e.message);} };

const u = await m.fetchUniverse({ topN: 10, minQuoteVolume24h: 1 });
t('falls through Binance failure to OKX', ()=>{ if(m.getActiveProvider()!=='okx') throw new Error('provider='+m.getActiveProvider()); });
t('OKX symbols normalised to Binance style', ()=>{ if(u[0].symbol!=='BTCUSDT') throw new Error(u[0].symbol); });
t('non-USDT quote pairs excluded', ()=>{ if(u.find(x=>x.symbol.includes('USDC'))) throw new Error('USDC pair leaked in'); });
t('24h change computed from open', ()=>{ const b=u.find(x=>x.symbol==='BTCUSDT'); const exp=((64000.1-62000)/62000)*100; if(Math.abs(b.change24h-exp)>1e-6) throw new Error(b.change24h+' vs '+exp); });
t('negative change preserved', ()=>{ const e=u.find(x=>x.symbol==='ETHUSDT'); if(!(e.change24h<0)) throw new Error('ETH should be down, got '+e.change24h); });
t('sorted by quote volume desc', ()=>{ if(!(u[0].quoteVolume24h>=u[1].quoteVolume24h)) throw new Error('not sorted'); });

const c = await m.fetchCandles('BTCUSDT','1h',200);
t('OKX candles reversed to oldest-first', ()=>{ if(!(c[0].openTime < c[c.length-1].openTime)) throw new Error('wrong order'); });
t('unconfirmed forming bar dropped', ()=>{ if(c.find(x=>x.openTime===1700007200000)) throw new Error('forming bar kept'); });
t('OHLC mapped to correct fields', ()=>{ const b=c.find(x=>x.openTime===1700003600000); if(!(b.open===100&&b.high===102&&b.low===99&&b.close===101)) throw new Error(JSON.stringify(b)); });
t('internal _confirmed flag stripped from output', ()=>{ if('_confirmed' in c[0]) throw new Error('leaked internal field'); });

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
