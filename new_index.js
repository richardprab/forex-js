import puppeteer from 'puppeteer';

// Lark Configuration
const LARK_CONFIG = {
    APP_ID: 'cli_your_actual_app_id_here',
    APP_SECRET: 'your_actual_app_secret_here',
    SPREADSHEET_TOKEN: 'KUNHs3CFVhsub2tCf7LlOXeEgUe',

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
        console.log('Getting access token...');
        console.log('APP_ID:', LARK_CONFIG.APP_ID);
        console.log('APP_SECRET length:', LARK_CONFIG.APP_SECRET ? LARK_CONFIG.APP_SECRET.length : 'undefined');
        
        const requestBody = {
            app_id: LARK_CONFIG.APP_ID,
            app_secret: LARK_CONFIG.APP_SECRET
        };
        
        console.log('Request body:', JSON.stringify(requestBody, null, 2));
        
        const response = await fetch('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        console.log('Response status:', response.status);
        const data = await response.json();
        console.log('Response data:', JSON.stringify(data, null, 2));
        
        if (data.code === 0) {
            console.log('Access token obtained successfully');
            return data.tenant_access_token;
        } else {
            console.error('Failed to get access token:', data.msg);
            console.error('Error code:', data.code);
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
        if (!accessToken) {
            console.log('No access token for sheet lookup');
            return null;
        }

        console.log('Looking up sheets in spreadsheet...');
        const response = await fetch(`https://open.larksuite.com/open-apis/sheets/v3/spreadsheets/${LARK_CONFIG.SPREADSHEET_TOKEN}/sheets/query`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();
        console.log('Sheet lookup response:', result);
        
        if (result.code === 0 && result.data.sheets.length > 0) {
            const sheetId = result.data.sheets[0].sheet_id;
            console.log(`Using sheet: ${result.data.sheets[0].title} (ID: ${sheetId})`);
            return sheetId;
        } else {
            console.log('No sheets found or error:', result.msg);
        }
    } catch (error) {
        console.error('Error finding sheet ID:', error);
    }
    
    return null;
}

// Send data to Lark spreadsheet
async function sendToLarkSheet(bankData) {
    try {
        console.log(`Attempting to send ${bankData.bank} data to spreadsheet...`);
        
        const accessToken = await getAccessToken();
        if (!accessToken) {
            console.log('Failed to get access token for sheet write');
            return;
        }

        const sheetId = await findSheetID();
        if (!sheetId) {
            console.log('Failed to get sheet ID');
            return;
        }

        const timestamp = new Date().toLocaleString('en-US', { 
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const values = [
            [
                timestamp,
                bankData.bank,
                bankData.currency,
                bankData.buyRate,
                bankData.sellRate
            ]
        ];

        console.log('Data to send:', values[0]);
        console.log(`Writing to sheet ${sheetId} range A:E`);

        const response = await fetch(`https://open.larksuite.com/open-apis/sheets/v2/spreadsheets/${LARK_CONFIG.SPREADSHEET_TOKEN}/values_append`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                valueRange: {
                    range: `${sheetId}!A:E`,
                    values: values
                }
            })
        });

        const result = await response.json();
        console.log('Sheet write response:', result);
        
        if (result.code === 0) {
            console.log(`${bankData.bank} data successfully added to spreadsheet`);
        } else {
            console.error(`Failed to add ${bankData.bank} data: ${result.msg}`);
        }

    } catch (error) {
        console.error(`Error sending ${bankData.bank} to spreadsheet:`, error);
    }
}

const bank_parser = async (bank) => {
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
            } else if (bankName === 'BCA') {
                const firstCell = cells[0]?.innerText.trim();
                
                if (firstCell.includes('USD')) {
                    currency = 'USD';
                    buy = cells[1]?.innerText.trim();
                    sell = cells[2]?.innerText.trim();
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
bank_parser('CIMB');
bank_parser('BCA');