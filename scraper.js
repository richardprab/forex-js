// scraper.js - Main scraping logic
const puppeteer = require('puppeteer');

// Get configuration from environment variables
const LARK_CONFIG = {
  APP_ID: process.env.LARK_APP_ID,
  APP_SECRET: process.env.LARK_APP_SECRET,
  SPREADSHEET_TOKEN: process.env.LARK_SPREADSHEET_TOKEN,
};

const BANK_CONFIGS = {
  CIMB: {
    url: "https://www.cimbniaga.co.id/content/cimb/id/personal/treasury/kurs-valas/jcr:content/responsivegrid/kurs_copy_copy_copy.get-content/",
    parseNumber: (str) => parseFloat(str.replace(/,/g, "")),
    selector: "table tr",
  },
  BCA: {
    url: "https://www.bca.co.id/id/informasi/kurs",
    parseNumber: (str) => parseFloat(str.replace(/\./g, "").replace(",", ".")),
    selector: "table tbody tr",
  },
};

// Store rates from both banks
let allRates = {};

// Get access token for Lark API
async function getAccessToken() {
  try {
    const response = await fetch(
      "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app_id: LARK_CONFIG.APP_ID,
          app_secret: LARK_CONFIG.APP_SECRET,
        }),
      }
    );
    const data = await response.json();
    if (data.code === 0) {
      console.log('Got Lark access token');
      return data.tenant_access_token;
    } else {
      console.error("Failed to get access token:", data.msg);
      return null;
    }
  } catch (error) {
    console.error("Error getting access token:", error);
    return null;
  }
}

// Find sheet ID from spreadsheet
async function findSheetID() {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return null;
    
    const response = await fetch(
      `https://open.larksuite.com/open-apis/sheets/v3/spreadsheets/${LARK_CONFIG.SPREADSHEET_TOKEN}/sheets/query`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    const result = await response.json();
    if (result.code === 0 && result.data.sheets.length > 0) {
      console.log('Found sheet ID');
      return result.data.sheets[0].sheet_id;
    }
  } catch (error) {
    console.error("Error finding sheet ID:", error);
  }
  return null;
}

// Send data to Lark spreadsheet
async function sendToLarkSheet(bankData) {
  // Store the bank data
  allRates[bankData.bank] = bankData;
  console.log(`Stored ${bankData.bank} rates: Buy ${bankData.buyRate}, Sell ${bankData.sellRate}`);

  // Only send to Lark when we have both banks' data
  if (Object.keys(allRates).length === 2) {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Failed to get Lark access token');
      }

      const sheetId = await findSheetID();
      if (!sheetId) {
        throw new Error('Failed to find sheet ID');
      }

      const currentDate = new Date();
      const jakartaDate = currentDate.toLocaleDateString("en-GB", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "short",
        year: "2-digit",
      });
      const jakartaTime = currentDate.toLocaleTimeString("en-US", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      // Get rates from both banks
      const cimbData = allRates["CIMB"] || {};
      const bcaData = allRates["BCA"] || {};

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
          "", // Empty
        ],
        [
          jakartaDate, // Date
          "Withdrawal", // Type (sell rates)
          jakartaTime, // Cut Off Time
          "", // Gotrade Indo
          "", // Gotrade Global
          "", // Pluang
          "", // Reku
          cimbData.sellRate || "", // CIMB sell rate
          bcaData.sellRate || "", // BCA sell rate (side by side with CIMB)
          "", // Empty
          "", // Empty
        ],
      ];

      const response = await fetch(
        `https://open.larksuite.com/open-apis/sheets/v2/spreadsheets/${LARK_CONFIG.SPREADSHEET_TOKEN}/values_append`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            valueRange: {
              range: `${sheetId}!A:K`,
              values: values,
            },
          }),
        }
      );

      const result = await response.json();
      if (result.code === 0) {
        console.log("Combined data sent to Lark spreadsheet");
        return { success: true, rows: values.length };
      } else {
        throw new Error(`Lark API error: ${result.msg}`);
      }
    } catch (error) {
      console.error("Error sending combined data to spreadsheet:", error);
      throw error;
    } finally {
      // Reset for next run
      allRates = {};
    }
  }
}

const bank_parser = async (bank) => {
  const config = BANK_CONFIGS[bank.toUpperCase()];
  if (!config) throw new Error(`Unsupported bank: ${bank}`);

  console.log(`Starting ${bank} scraper...`);
  
  const browser = await puppeteer.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-zygote',
      '--single-process', // Important for Cloud Run
      '--disable-gpu'
    ]
  });
  
  const page = await browser.newPage();
  const url = config.url;

  try {
    await page.goto(url, { 
      waitUntil: "domcontentloaded",
      timeout: 30000 
    });
    await page.waitForSelector(config.selector, { timeout: 15000 });

    const usd = await page.evaluate(
      (selector, bankName) => {
        const rows = document.querySelectorAll(selector);

        for (const row of rows) {
          const cells = row.querySelectorAll("td");
          if (cells.length < 3) continue;

          let currency, buy, sell;

          if (bankName === "CIMB") {
            currency = cells[0]?.innerText.trim();
            buy = cells[1]?.innerText.trim();
            sell = cells[2]?.innerText.trim();

            if (currency === "USD" && buy && sell) {
              return {
                buyRate: parseFloat(buy),
                sellRate: parseFloat(sell),
              };
            }
          } else if (bankName === "BCA") {
            const firstCell = cells[0]?.innerText.trim();
            if (firstCell.includes("USD")) {
              const buyText = cells[1]?.innerText.trim();
              const sellText = cells[2]?.innerText.trim();

              const buyParts = buyText.replace(/[^\d.,]/g, "").split(",");
              const sellParts = sellText.replace(/[^\d.,]/g, "").split(",");

              return {
                buyRate: parseInt(buyParts[0].replace(/\./g, "")),
                sellRate: parseInt(sellParts[0].replace(/\./g, "")),
              };
            }
          }
        }
        return null;
      },
      config.selector,
      bank.toUpperCase()
    );

    if (usd) {
      console.log(`${bank}: Buy ${usd.buyRate}, Sell ${usd.sellRate}`);
      await sendToLarkSheet({ bank: bank.toUpperCase(), ...usd });
      return { bank: bank.toUpperCase(), ...usd };
    } else {
      throw new Error(`${bank}: USD data not found`);
    }
  } finally {
    await browser.close();
  }
};

// Main function to run both scrapers
async function runForexScraper() {
  try {
    console.log('Starting forex scraper for both banks...');
    
    // Validate environment variables
    if (!LARK_CONFIG.APP_ID || !LARK_CONFIG.APP_SECRET || !LARK_CONFIG.SPREADSHEET_TOKEN) {
      throw new Error('Missing required Lark configuration. Please check environment variables.');
    }
    
    // Run both scrapers concurrently
    const results = await Promise.allSettled([
      bank_parser("CIMB"),
      bank_parser("BCA")
    ]);
    
    const successful = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason);
    
    if (failed.length > 0) {
      console.error('Some scrapers failed:', failed.map(f => f.message));
    }
    
    if (successful.length === 0) {
      throw new Error('All scrapers failed');
    }
    
    console.log(`Forex scraping completed. ${successful.length}/2 banks successful`);
    return {
      success: true,
      results: successful,
      errors: failed.map(f => f.message)
    };
    
  } catch (error) {
    console.error('Forex scraper failed:', error);
    throw error;
  }
}

module.exports = { runForexScraper };

// For direct execution (testing)
if (require.main === module) {
  runForexScraper()
    .then(result => {
      console.log('Scraper completed:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('Scraper failed:', error);
      process.exit(1);
    });
}