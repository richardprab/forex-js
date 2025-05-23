import puppeteer from 'puppeteer';
import secrets from './secrets.json' with { type: 'json' };

const LARK_CONFIG = {
    APP_ID: secrets.APP_ID,
    APP_SECRET: secrets.APP_SECRET,
    SPREADSHEET_TOKEN: secrets.SPREADSHEET_TOKEN,
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

// Store rates from both banks
let allRates = {};

// Send data to Lark spreadsheet
async function sendToLarkSheet(bankData) {
    // Store the bank data
    allRates[bankData.bank] = bankData;
    
    // Only send to Lark when we have both banks' data
    if (Object.keys(allRates).length === 2) {
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
                hour12: true
            });
            
            // Get rates from both banks
            const cimbData = allRates['CIMB'] || {};
            const bcaData = allRates['BCA'] || {};
            
            // Create two rows: one for Deposit (buy rates), one for Withdrawal (sell rates)
            const values = [
                [
                    jakartaDate, // Date
                    "Deposit", // Type (buy rates)
                    jakartaTime, // Cut Off Time
                    "", // Gotrade Indo
                    "", // Gotrade Global
                    "", // Pluang
                    "", // Reku
                    cimbData.buyRate || "", // CIMB buy rate
                    bcaData.buyRate || "", // BCA buy rate (side by side with CIMB)
                    "", // Empty
                    "" // Empty
                ],
                [
                    jakartaDate, // Date
                    "Withdrawal", // Type (sell rates)
                    jakartaTime, // Cut Off Time
                    "", // Gotrade Indo
                    "", // Gotrade Global
                    "", // Pluang
                    "", // Reku
                    cimbData.sellRate || "", // CIMB sell rate (shifted left by 1)
                    bcaData.sellRate || "", // BCA sell rate (side by side with CIMB)
                    "", // Empty
                    "" // Empty
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
                console.log('Combined data sent to Lark spreadsheet');
            } else {
                console.error('Failed to send combined data:', result.msg);
            }
            
            // Reset for next run
            allRates = {};
        } catch (error) {
            console.error('Error sending combined data to spreadsheet:', error);
        }
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
                
                if (currency === 'USD' && buy && sell) {
                    return {
                        buyRate: parseFloat(buy),
                        sellRate: parseFloat(sell)
                    };
                }
            } else if (bankName === 'BCA') {
                const firstCell = cells[0]?.innerText.trim();
                if (firstCell.includes('USD')) {
                    const buyText = cells[1]?.innerText.trim();
                    const sellText = cells[2]?.innerText.trim();
                    
                    const buyParts = buyText.replace(/[^\d.,]/g, '').split(',');
                    const sellParts = sellText.replace(/[^\d.,]/g, '').split(',');
                    
                    return {
                        buyRate: parseInt(buyParts[0].replace(/\./g, '')),
                        sellRate: parseInt(sellParts[0].replace(/\./g, ''))
                    };
                }
            }
        }
        return null;
    }, config.selector, bank.toUpperCase());
    
    if (usd) {
        console.log(`${bank}: Buy ${usd.buyRate}, Sell ${usd.sellRate}`);
        await sendToLarkSheet({ bank: bank.toUpperCase(), ...usd });
    } else {
        console.log(`${bank}: USD data not found`);
    }
    
    await browser.close();
};

// Run for both banks
bank_parser('CIMB');
bank_parser('BCA');