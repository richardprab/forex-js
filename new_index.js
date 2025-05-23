import puppeteer from 'puppeteer';

// Lark Configuration
const LARK_CONFIG = {
    APP_ID: 'x',
    APP_SECRET: 'y',
    SPREADSHEET_TOKEN: 'z',

};

const BANK_CONFIGS = {
    CIMB: {
        url: "https://www.cimbniaga.co.id/content/cimb/id/personal/treasury/kurs-valas/jcr:content/responsivegrid/kurs_copy_copy_copy.get-content/",
        parseNumber: (str) => parseFloat(str.replace(/,/g, '')),
        selector: 'table tr'
    },
    BCA: {
        url: "https://www.bca.co.id/id/informasi/kurs",
        parseNumber: (str) => parseFloat(
            str.replace(/\./g, '').replace(',', '.')
        ),
        selector: 'table tbody tr'
    }
};

// Get access token for Lark API
async function getAccessToken() {
    try {
        const response = await fetch('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                app_id: LARK_CONFIG.APP_ID,
                app_secret: LARK_CONFIG.APP_SECRET
            })
        });

        const data = await response.json();
        if (data.code === 0) {
            return data.tenant_access_token;
        } else {
            console.error('Failed to get access token:', data.msg);
            return null;
        }
    } catch (error) {
        console.error('Error getting access token:', error);
        return null;
    }
}

// Find sheet ID from spreadsheet
async function findSheetID() {
    try {
        const accessToken = await getAccessToken();
        if (!accessToken) return null;

        const response = await fetch(`https://open.larksuite.com/open-apis/sheets/v3/spreadsheets/${LARK_CONFIG.SPREADSHEET_TOKEN}/sheets/query`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();
        
        if (result.code === 0 && result.data.sheets.length > 0) {
            return result.data.sheets[0].sheet_id;
        }
    } catch (error) {
        console.error('Error finding sheet ID:', error);
    }
    
    return null;
}

// Send data to Lark spreadsheet
async function sendToLarkSheet(bankData) {
    try {
        const accessToken = await getAccessToken();
        if (!accessToken) return;

        const sheetId = await findSheetID();
        if (!sheetId) return;

        const currentDate = new Date();
        const jakartaDate = currentDate.toLocaleDateString('en-GB', { 
            timeZone: 'Asia/Jakarta',
            day: '2-digit',
            month: 'short',
            year: '2-digit'
        });
        
        const jakartaTime = currentDate.toLocaleTimeString('en-US', {
            timeZone: 'Asia/Jakarta',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        // Determine transaction type based on buy/sell rates
        const transactionType = bankData.buyRate > bankData.sellRate ? "Withdrawal" : "Deposit";

        const values = [
            [
                jakartaDate,        // Date (23-May-25)
                transactionType,    // Type (Deposit/Withdrawal)
                jakartaTime,        // Cut Off Time (10:00)
                "",                 // Gotrade Indo (empty)
                "",                 // Gotrade Global (empty)
                "",                 // Pluang (empty)
                "",                 // Reku (empty)
                bankData.bank === 'CIMB' ? bankData.buyRate : "", // CIMB buy rate
                bankData.bank === 'CIMB' ? bankData.sellRate : "", // CIMB sell rate  
                bankData.bank === 'BCA' ? bankData.buyRate : "",   // BCA buy rate
                bankData.bank === 'BCA' ? bankData.sellRate : ""   // BCA sell rate
            ]
        ];

        const response = await fetch(`https://open.larksuite.com/open-apis/sheets/v2/spreadsheets/${LARK_CONFIG.SPREADSHEET_TOKEN}/values_append`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                valueRange: {
                    range: `${sheetId}!A:K`,
                    values: values
                }
            })
        });

        const result = await response.json();
        
        if (result.code === 0) {
            console.log(`${bankData.bank} data sent to Lark spreadsheet`);
        } else {
            console.error(`Failed to send ${bankData.bank} data:`, result.msg);
        }

    } catch (error) {
        console.error(`Error sending ${bankData.bank} to spreadsheet:`, error);
    }
}

const cimb_parser = async (bank) => {
    const config = BANK_CONFIGS[bank.toUpperCase()];
    if (!config) throw new Error(`Unsupported bank: ${bank}`);

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const url = config.url;
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await page.waitForSelector(config.selector);

    const usd = await page.evaluate((selector, bankName) => {
        const rows = document.querySelectorAll(selector);
        
        for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 3) continue;
            
            let currency, buy, sell;
            
            if (bankName === 'CIMB') {
                currency = cells[0]?.innerText.trim();
                buy = cells[1]?.innerText.trim();
                sell = cells[2]?.innerText.trim();
                
                // Clean and convert CIMB numbers to numeric values
                if (currency === 'USD' && buy && sell) {
                    buy = buy.replace(/[^\d.]/g, '');
                    sell = sell.replace(/[^\d.]/g, '');
                }
            } else if (bankName === 'BCA') {
                const firstCell = cells[0]?.innerText.trim();
                
                if (firstCell.includes('USD')) {
                    currency = 'USD';
                    const buyText = cells[1]?.innerText.trim();
                    const sellText = cells[2]?.innerText.trim();
                    
                    // Clean and convert BCA numbers to numeric values
                    const buyStr = buyText.replace(/[^\d.,]/g, '').replace(',', '.');
                    const sellStr = sellText.replace(/[^\d.,]/g, '').replace(',', '.');
                    
                    buy = buyStr;
                    sell = sellStr;
                }
            }
            
            if (currency === 'USD' && buy && sell) {
                const cleanBuy = buy.replace(/[^\d.,]/g, '').replace(',', '.');
                const cleanSell = sell.replace(/[^\d.,]/g, '').replace(',', '.');
                
                return {
                    currency,
                    buyRate: cleanBuy.replace('.', ''),
                    sellRate: cleanSell.replace('.', '')
                };
            }
        }
        return null;
    }, config.selector, bank.toUpperCase());

    if (usd) {
        console.log('USD Rate:', usd);
        await sendToLarkSheet({ bank: bank.toUpperCase(), ...usd });
    } else {
        console.log('USD Data not found');
    }

    await browser.close();
};

// Run for both banks
cimb_parser('CIMB');
cimb_parser('BCA');