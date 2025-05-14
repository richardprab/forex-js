import puppeteer from 'puppeteer';

const BANK_CONFIGS = {
    CIMB: {
        url: "https://www.cimbniaga.co.id/content/cimb/id/personal/treasury/kurs-valas/jcr:content/responsivegrid/kurs_copy_copy_copy.get-content/",
        parseNumber: (str) => parseFloat(str.replace(/,/g, '')),
        selector: '.kurs-valas table tbody tr'
    },
    BCA: {
        url: "https://www.bca.co.id/id/informasi/kurs",
        parseNumber: (str) => parseFloat(
            str.replace(/\./g, '').replace(',', '.')
        ),
        selector: '.m-table-kurs tbody tr'
    }
};

const cimb_parser = async (bank) => {
    const config = BANK_CONFIGS[bank.toUpperCase()];
    if (!config) throw new Error(`Unsupported bank: ${bank}`);


    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const url = config.url;
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await page.waitForSelector(config.selector);

    const usd = await page.evaluate(() => {
        const rows = document.querySelectorAll(config.selector);
        for (const row of rows) {
            const currency = row.querySelector('td.td1')?.innerText.trim();
            if (currency === 'USD') {
                const buy = row.querySelector('td.td2')?.innerText.trim().replace(',', '');
                const sell = row.querySelector('td.td3')?.innerText.trim().replace(',', '');
                return {
                    currency,
                    buyRate: parseFloat(buy),
                    sellRate: parseFloat(sell)
                };
            }
        }
        return null;
    });

    if (usd) {
        console.log('USD Rate:', usd);
    } else {
        console.log('USD Data not found');
    }

    await browser.close();
};



cimb_parser();